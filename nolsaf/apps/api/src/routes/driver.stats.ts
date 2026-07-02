import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import qrcode from 'qrcode';
import { authenticator } from 'otplib';
import crypto from 'crypto';
import argon2 from 'argon2';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { validatePasswordStrength, isPasswordReused, addPasswordToHistory } from '../lib/security.js';
import { validatePasswordWithSettings } from '../lib/securitySettings.js';
import { requireAuth, blockImpersonated, AuthedRequest } from "../middleware/auth.js";
import { z } from "zod";
import { limitDriverLocationUpdate, limitDriverAvailabilityToggle } from "../middleware/rateLimit.js";
import { isTrustedUserDocumentUrl } from "../lib/userDocumentSecurity.js";
import { getWebAuthnRp } from "../lib/webauthnRp.js";
import { getRedis } from "../lib/redis.js";

// local no-op audit helper to satisfy references to `audit`
// If the application provides an audit function via req.app.get('audit'), delegate to it.
async function audit(req: AuthedRequest, action: string, target: string, before?: any, after?: any) {
  try {
    const maybeAudit = (req.app && (req.app as any).get && (req.app as any).get('audit')) as any;
    if (typeof maybeAudit === 'function') {
      // call the app-provided audit handler if available
      await maybeAudit({ req, action, target, before, after });
    }
  } catch (e) {
    // ignore audit errors
  }
}

export const router = Router();
router.use(requireAuth as unknown as RequestHandler);

// In-memory demo store for passkey credentials when DB model is not available
const passkeyStore = new Map<string, Array<any>>(); // userId -> [{ id, name, createdAt }]

// Passkey challenges live in Redis so options + verify can hit different
// instances; the Map is a single-instance dev fallback (same pattern as account.ts).
const passkeyChallenges = new Map<string, { challenge: string; expiresAt: number }>();
const DRIVER_PASSKEY_CHALLENGE_TTL_SEC = 5 * 60;
const DRIVER_PASSKEY_CHALLENGE_PREFIX = "driver:passkey:challenge:";

async function setDriverPasskeyChallenge(userId: number | string, challenge: string): Promise<void> {
  const key = String(userId);
  const expiresAt = Date.now() + DRIVER_PASSKEY_CHALLENGE_TTL_SEC * 1000;
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(
        `${DRIVER_PASSKEY_CHALLENGE_PREFIX}${key}`,
        JSON.stringify({ challenge, expiresAt }),
        "EX",
        DRIVER_PASSKEY_CHALLENGE_TTL_SEC
      );
      return;
    }
  } catch {
    // Redis is preferred for multi-instance correctness; memory keeps single-instance dev working.
  }
  passkeyChallenges.set(key, { challenge, expiresAt });
}

async function getDriverPasskeyChallenge(userId: number | string): Promise<string | null> {
  const key = String(userId);
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(`${DRIVER_PASSKEY_CHALLENGE_PREFIX}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { challenge?: string; expiresAt?: number };
      if (!parsed.challenge || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) return null;
      return parsed.challenge;
    }
  } catch {
    // fall back below
  }

  const stored = passkeyChallenges.get(key);
  if (!stored) return null;
  if (stored.expiresAt <= Date.now()) {
    passkeyChallenges.delete(key);
    return null;
  }
  return stored.challenge;
}

async function deleteDriverPasskeyChallenge(userId: number | string): Promise<void> {
  const key = String(userId);
  try {
    const redis = getRedis();
    if (redis) await redis.del(`${DRIVER_PASSKEY_CHALLENGE_PREFIX}${key}`);
  } catch {
    // best effort
  }
  passkeyChallenges.delete(key);
}

function toBase64Url(buf: Buffer | Uint8Array) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(s: string) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * GET /driver/stats?date=YYYY-MM-DD
 * Returns lightweight stats for the driver: todaysRides, earnings, rating
 * Attempts to compute values from DB, but falls back to zeros if models/fields are absent.
 */
const getStats: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const date = (req.query.date as string) || undefined;
  try {
    // Best-effort: try to count bookings assigned to this driver on the date
    let todaysRides = 0;
    let earnings = 0;
    let rating = 0;

    // If prisma has a booking model with driverId and scheduledAt/date fields, use it.
    try {
      // Attempt common field names; wrap in try/catch to avoid runtime error if model differs
      const where: any = { driverId: user.id };
      if (date) {
        // match date by scheduledAt between start/end of the day
        const start = new Date(date + "T00:00:00.000Z");
        const end = new Date(date + "T23:59:59.999Z");
        where.scheduledAt = { gte: start, lte: end };
      }
      // count bookings
      if ((prisma as any).booking) {
        todaysRides = await (prisma as any).booking.count({ where });
        // Sum earnings from completed bookings if price/amount fields exist
        const completed = await (prisma as any).booking.findMany({ where: { ...where, status: { in: ["COMPLETED", "FINISHED", "PAID"] } }, select: { price: true } });
        earnings = (completed || []).reduce((s: number, b: any) => s + (Number(b.price) || 0), 0);
      }
    } catch (e) {
      // ignore and fallback to 0s
    }

    // rating: if user has rating field, use it
    try {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { rating: true } as any });
      if (u && typeof (u as any).rating === "number") rating = (u as any).rating;
    } catch (e) {
      // ignore
    }

    return res.json({ todaysRides, earnings, rating });
  } catch (err) {
    console.warn("driver.stats: failed to compute stats", err);
    return res.json({ todaysRides: 0, earnings: 0, rating: 0 });
  }
};
router.get("/stats", getStats as unknown as RequestHandler);

/**
 * Platform default daily earnings goal (TZS) shown on the driver dashboard.
 * Per-driver goals are set client-side (see the web dashboard's "Set Goals" modal);
 * this server value is only the fallback default. Overridable via env so ops can tune
 * it without a code change or DB migration.
 */
const DEFAULT_DRIVER_DAILY_GOAL_TZS = 100_000;
/** Online hours after which the dashboard surfaces a "take a break" reminder. */
const BREAK_REMINDER_HOURS = 3.5;

function getDriverDailyGoalTzs(): number {
  const raw = Number(process.env.DRIVER_DAILY_GOAL_TZS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DRIVER_DAILY_GOAL_TZS;
}

/**
 * GET /driver/dashboard
 * Returns comprehensive dashboard statistics for the authenticated driver
 */
const getDashboard: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const driverId = Number(user.id);

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Trips this driver completed today (drives the earnings/rides cards)
    const todaysTrips = await prisma.transportBooking.findMany({
      where: {
        driverId,
        status: "COMPLETED",
        updatedAt: { gte: today, lt: tomorrow },
      },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        updatedAt: true,
        fromAddress: true,
        fromRegion: true,
        toAddress: true,
        toRegion: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    const todaysRides = todaysTrips.length;
    const todayEarnings = todaysTrips.reduce((sum, trip) => sum + Number(trip.amount || 0), 0);

    // Acceptance rate from real auto-dispatch offer history
    let acceptanceRate = 0;
    const totalOffered = await prisma.transportBookingOffer.count({ where: { driverId } });
    if (totalOffered > 0) {
      const totalAccepted = await prisma.transportBookingOffer.count({ where: { driverId, status: "ACCEPTED" } });
      acceptanceRate = Math.round((totalAccepted / totalOffered) * 100);
    }

    // Driver rating + reviews
    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      select: { rating: true },
    });
    const rating = driver?.rating ? Number(driver.rating) : 0;
    const totalReviews = await prisma.transportBooking.count({
      where: { driverId, userRating: { not: null } },
    });

    // Online hours - approximated from the span between this driver's first and last location ping today
    let onlineHours = 0;
    const pings = await prisma.driverLocationPing.findMany({
      where: { driverId, createdAt: { gte: today, lt: tomorrow } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (pings.length > 1) {
      const spanMs = pings[pings.length - 1].createdAt.getTime() - pings[0].createdAt.getTime();
      onlineHours = Math.round((spanMs / (1000 * 60 * 60)) * 10) / 10;
    }

    // Peak-hour surge is not implemented in the fare engine (transportPolicy uses flat
    // per-km rates with no multiplier), so we must not advertise a surge that drivers
    // would never actually be paid. The web dashboard likewise does not surface this.
    // Return null until real surge pricing exists; both clients render nothing for null.
    const peakHours: null = null;

    // Earnings chart - last 7 days from real completed trips
    const earningsChart: Array<{ day: string; amount: number }> = [];
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const weekTrips = await prisma.transportBooking.findMany({
      where: { driverId, status: "COMPLETED", updatedAt: { gte: sevenDaysAgo, lt: tomorrow } },
      select: { amount: true, updatedAt: true },
    });
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(sevenDaysAgo);
      dayStart.setDate(dayStart.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayEarnings = weekTrips
        .filter((trip) => trip.updatedAt >= dayStart && trip.updatedAt < dayEnd)
        .reduce((sum, trip) => sum + Number(trip.amount || 0), 0);

      earningsChart.push({ day: dayStart.toLocaleDateString("en-US", { weekday: "short" }), amount: dayEarnings });
    }

    // Trips by hour - calculate from today's completed trips
    const tripsChart: Array<{ hour: string; trips: number }> = [
      { hour: "6AM", trips: 0 },
      { hour: "9AM", trips: 0 },
      { hour: "12PM", trips: 0 },
      { hour: "3PM", trips: 0 },
      { hour: "6PM", trips: 0 },
      { hour: "9PM", trips: 0 },
    ];

    todaysTrips.forEach((trip) => {
      const hour = new Date(trip.createdAt).getHours();
      if (hour >= 6 && hour < 9) tripsChart[0].trips++;
      else if (hour >= 9 && hour < 12) tripsChart[1].trips++;
      else if (hour >= 12 && hour < 15) tripsChart[2].trips++;
      else if (hour >= 15 && hour < 18) tripsChart[3].trips++;
      else if (hour >= 18 && hour < 21) tripsChart[4].trips++;
      else tripsChart[5].trips++;
    });

    // Demand zones - return empty array until real demand zone logic is implemented
    const demandZones: Array<{ name: string; level: "high" | "medium" | "low" }> = [];

    // Recent trips - last 5 bookings for this driver, regardless of status
    const recentTripsData = await prisma.transportBooking.findMany({
      where: { driverId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        updatedAt: true,
        fromAddress: true,
        fromRegion: true,
        toAddress: true,
        toRegion: true,
        amount: true,
      },
    });

    const recentTrips = recentTripsData.map((trip) => ({
      id: String(trip.id),
      time: trip.updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      from: trip.fromAddress || trip.fromRegion || "Unknown",
      to: trip.toAddress || trip.toRegion || "Unknown",
      distance: "N/A",
      amount: Number(trip.amount || 0),
    }));

    // Reminders
    const reminders: Array<{ id: string; type: "warning" | "info"; message: string; action?: string; actionLink?: string }> = [];

    if (onlineHours >= BREAK_REMINDER_HOURS) {
      reminders.push({
        id: "break-reminder",
        type: "info",
        message: `Take a break - you've been driving ${onlineHours.toFixed(1)} hours`,
      });
    }

    const todayGoal = getDriverDailyGoalTzs();
    const goalProgress = todayGoal > 0 ? Math.min(Math.round((todayEarnings / todayGoal) * 100), 100) : 0;

    return res.json({
      todayGoal,
      todayEarnings,
      goalProgress,
      todaysRides,
      acceptanceRate,
      rating: parseFloat(rating.toFixed(1)),
      totalReviews,
      onlineHours,
      peakHours,
      earningsChart,
      tripsChart,
      demandZones,
      recentTrips,
      reminders,
    });
  } catch (err) {
    console.error("driver.dashboard: failed to fetch dashboard data", err);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};
router.get("/dashboard", getDashboard as unknown as RequestHandler);

/**
 * GET /driver/map
 * Returns a lightweight payload for rendering a live map: driverLocation + assignments + nearbyDrivers
 * Best-effort from DB; otherwise returns sample data.
 */
const getMapData: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    // Attempt to read driver's last known location from DriverLiveLocation
    let driverLocation: any = null;
    try {
      if ((prisma as any).driverLiveLocation) {
        const loc = await (prisma as any).driverLiveLocation.findUnique({ where: { driverId: user.id } });
        if (loc) {
          driverLocation = {
            id: loc.driverId,
            lat: Number(loc.lat),
            lng: Number(loc.lng),
            headingDeg: loc.headingDeg ?? null,
            speedMps: loc.speedMps !== null && typeof loc.speedMps !== "undefined" ? Number(loc.speedMps) : null,
            accuracyM: loc.accuracyM !== null && typeof loc.accuracyM !== "undefined" ? Number(loc.accuracyM) : null,
            updatedAt: loc.updatedAt,
          };
        }
      }
    } catch (e) {
      // ignore
    }

    // Assignments: bookings assigned to this driver with pickup/dropoff coordinates
    let assignments: any[] = [];
    try {
      if ((prisma as any).booking) {
        const where: any = { driverId: user.id, status: { in: ["ASSIGNED", "IN_PROGRESS"] } };
        const items = await (prisma as any).booking.findMany({ 
          where, 
          select: { id: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, status: true, passengerName: true } 
        });
        assignments = (items || []).map((b: any) => ({ 
          id: b.id, 
          pickup: b.pickupLat && b.pickupLng ? { lat: Number(b.pickupLat), lng: Number(b.pickupLng) } : null, 
          dropoff: b.dropoffLat && b.dropoffLng ? { lat: Number(b.dropoffLat), lng: Number(b.dropoffLng) } : null, 
          status: b.status, 
          passengerName: b.passengerName 
        }));
      }
    } catch (e) {
      // ignore
    }

    // Nearby drivers: best-effort from DriverLiveLocation with a small bounding box + recency filter
    let nearbyDrivers: any[] = [];
    try {
      if ((prisma as any).driverLiveLocation) {
        const now = Date.now();
        const since = new Date(now - 10 * 60 * 1000); // last 10 minutes
        // Default: broad list
        let where: any = { updatedAt: { gte: since } };
        // If we have a driver center, tighten to a nearby bounding box (~15km)
        if (driverLocation && typeof driverLocation.lat === "number" && typeof driverLocation.lng === "number") {
          const lat = driverLocation.lat;
          const lng = driverLocation.lng;
          const d = 0.14; // approx degrees ~ 15km
          where = {
            updatedAt: { gte: since },
            lat: { gte: lat - d, lte: lat + d },
            lng: { gte: lng - d, lte: lng + d },
          };
        }
        const list = await (prisma as any).driverLiveLocation.findMany({
          where,
          take: 75,
          orderBy: { updatedAt: "desc" },
          include: { driver: { select: { id: true, name: true, available: true } } },
        });
        nearbyDrivers = (list || [])
          .filter((d: any) => d?.driverId !== user.id)
          .map((d: any) => ({
            id: d.driverId,
            name: d.driver?.name ?? null,
            available: typeof d.driver?.available === "boolean" ? d.driver.available : null,
            lat: Number(d.lat),
            lng: Number(d.lng),
          }));
      }
    } catch (e) {
      // ignore
    }

    // Development-only fallback. Production ride maps must never show synthetic
    // driver positions, because fake coordinates can mislead routing decisions.
    if (process.env.NODE_ENV !== "production" && !driverLocation && assignments.length === 0 && nearbyDrivers.length === 0) {
      driverLocation = { id: 'demo-self', lat: -6.7924, lng: 39.2083, updatedAt: new Date() };
      nearbyDrivers = [ { id: 'demo-1', lat: -6.79, lng: 39.21 }, { id: 'demo-2', lat: -6.795, lng: 39.205 } ];
    }

    return res.json({ driverLocation, assignments, nearbyDrivers });
  } catch (err) {
    console.warn('driver.map: failed', err);
    return res.json({ driverLocation: null, assignments: [], nearbyDrivers: [] });
  }
};
router.get('/map', getMapData as unknown as RequestHandler);

/**
 * GET /driver/safety?date=...&start=...&end=...
 * Returns safety events or monthly summaries for the authenticated driver.
 * Best-effort: try driverSafety or safetyEvent models, otherwise return empty list.
 */
const getSafety: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const date = (req.query.date as string) || undefined;
    const start = (req.query.start as string) || undefined;
    const end = (req.query.end as string) || undefined;

    // If a dedicated safety model exists, return rows for this driver
    if ((prisma as any).driverSafety) {
      const where: any = { driverId: user.id };
      try {
        if (date) {
          const s = new Date(date + 'T00:00:00.000Z');
          const e = new Date(date + 'T23:59:59.999Z');
          where.timestamp = { gte: s, lte: e };
        } else if (start || end) {
          const s = start ? new Date(start + 'T00:00:00.000Z') : new Date(0);
          const e = end ? new Date(end + 'T23:59:59.999Z') : new Date();
          where.timestamp = { gte: s, lte: e };
        }
      } catch (e) { /* ignore */ }

      const items = await (prisma as any).driverSafety.findMany({ where, orderBy: { timestamp: 'desc' }, take: 1000 });
      return res.json({ items });
    }

    // Fallback: if a generic safetyEvent model exists
    if ((prisma as any).safetyEvent) {
      const where: any = { driverId: user.id };
      try {
        if (date) {
          const s = new Date(date + 'T00:00:00.000Z');
          const e = new Date(date + 'T23:59:59.999Z');
          where.timestamp = { gte: s, lte: e };
        } else if (start || end) {
          const s = start ? new Date(start + 'T00:00:00.000Z') : new Date(0);
          const e = end ? new Date(end + 'T23:59:59.999Z') : new Date();
          where.timestamp = { gte: s, lte: e };
        }
      } catch (e) { /* ignore */ }

      const items = await (prisma as any).safetyEvent.findMany({ where, orderBy: { timestamp: 'desc' }, take: 1000 });
      return res.json({ items });
    }

    // Last-resort: try to synthesize from bookings if available (look for flags)
    if ((prisma as any).booking) {
      const where: any = { driverId: user.id };
      let range: { gte: Date; lte: Date } | undefined;
      try {
        if (date) {
          const s = new Date(date + 'T00:00:00.000Z');
          const e = new Date(date + 'T23:59:59.999Z');
          range = { gte: s, lte: e };
        } else if (start || end) {
          const s = start ? new Date(start + 'T00:00:00.000Z') : new Date(0);
          const e = end ? new Date(end + 'T23:59:59.999Z') : new Date();
          range = { gte: s, lte: e };
        }
      } catch (e) { /* ignore */ }

      // Booking doesn't have `scheduledAt` in our schema; use the closest available fields.
      if (range) {
        where.OR = [
          { transportScheduledDate: range },
          { checkIn: range },
          { createdAt: range },
        ];
      }

      const items = await (prisma as any).booking.findMany({
        where,
        orderBy: [{ transportScheduledDate: 'desc' }, { checkIn: 'desc' }, { createdAt: 'desc' }],
        take: 1000,
      });
      // map bookings to simple safety-like events when flags exist
      const mapped = (items || []).flatMap((b: any) => {
        const out: any[] = [];
        if (b.hardBraking || b.harshAcceleration || b.speeding || b.ruleViolated) {
          out.push({
            id: `b-${b.id}`,
            date: b.transportScheduledDate ?? b.checkIn ?? b.createdAt,
            hardBraking: !!b.hardBraking,
            harshAcceleration: !!b.harshAcceleration,
            speeding: !!b.speeding,
            ruleViolated: !!b.ruleViolated,
            bookingId: b.id,
          });
        }
        return out;
      });
      return res.json({ items: mapped });
    }

    // otherwise return empty
    return res.json({ items: [] });
  } catch (err) {
    console.warn('driver.safety: failed', String(err));
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/safety', getSafety as unknown as RequestHandler);

/**
 * GET /driver/payouts?page=&pageSize=
 * Returns payouts for the authenticated driver. Best-effort:
 * - If a Payout model/table exists, return rows from it.
 * - Otherwise fall back to returning PAID invoices for bookings assigned to this driver.
 */
/** Maps a TransportPayout.status to the InvoiceStatus values understood by the driver app. */
function transportPayoutToInvoiceStatus(status: string | null | undefined): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'PAID':
      return 'PAID';
    case 'APPROVED':
      return 'APPROVED';
    case 'VERIFIED':
      return 'VERIFIED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'REQUESTED';
  }
}

const getPayouts: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const page = Math.max(1, Number((req.query as any).page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number((req.query as any).pageSize ?? 20)));
  const skip = (page - 1) * pageSize;

  try {
    const [items, total] = await Promise.all([
      prisma.transportPayout.findMany({
        where: { driverId: user.id, status: 'PAID' },
        include: { booking: { select: { tripCode: true } } },
        orderBy: { paidAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.transportPayout.count({ where: { driverId: user.id, status: 'PAID' } }),
    ]);

    return res.json({
      total,
      page,
      pageSize,
      items: items.map((p) => ({
        id: p.id,
        invoiceId: p.id,
        invoiceNumber: `PAYOUT-${p.id}`,
        tripCode: p.booking?.tripCode ?? null,
        paidAt: p.paidAt,
        paidTo: p.paymentRef ?? p.paymentMethod ?? null,
        gross: Number(p.grossAmount),
        commissionAmount: Number(p.commissionAmount),
        netPaid: Number(p.netPaid),
        receiptNumber: p.paymentRef ?? null,
      })),
    });
  } catch (err) {
    console.warn('driver.payouts: failed', String(err));
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/payouts', getPayouts as unknown as RequestHandler);

/**
 * GET /driver/invoices?page=&pageSize=
 * Returns the driver's payout claims (one per completed trip) as invoice-style
 * records, regardless of their PENDING / APPROVED / PAID status.
 */
const getInvoices: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const page = Math.max(1, Number((req.query as any).page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number((req.query as any).pageSize ?? 20)));
  const skip = (page - 1) * pageSize;

  try {
    const [items, total] = await Promise.all([
      prisma.transportPayout.findMany({
        where: { driverId: user.id },
        include: { booking: { select: { tripCode: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.transportPayout.count({ where: { driverId: user.id } }),
    ]);

    return res.json({
      total,
      page,
      pageSize,
      items: items.map((p) => ({
        id: p.id,
        invoiceId: p.id,
        invoiceNumber: `PAYOUT-${p.id}`,
        status: transportPayoutToInvoiceStatus(p.status),
        tripCode: p.booking?.tripCode ?? null,
        issuedAt: p.createdAt,
        approvedAt: p.approvedAt,
        paidAt: p.paidAt,
        paidTo: p.paymentRef ?? p.paymentMethod ?? null,
        gross: Number(p.grossAmount),
        commissionAmount: Number(p.commissionAmount),
        netPaid: Number(p.netPaid),
        receiptNumber: p.paymentRef ?? null,
      })),
    });
  } catch (err: any) {
    console.error('driver.invoices: failed', err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch error in /driver/invoices:', err.message);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    return res.status(500).json({ error: 'Internal server error', detail: err?.message || String(err) });
  }
};
router.get('/invoices', getInvoices as unknown as RequestHandler);

// GET /driver/goals — fetch this driver's saved weekly goals
const getGoals: RequestHandler = async (req: any, res: any) => {
  const user = req.user!;
  const row = await prisma.user.findUnique({ where: { id: Number(user.id) }, select: { driverGoals: true } });
  return res.json({ ok: true, goals: (row?.driverGoals as any) ?? null });
};
router.get('/goals', getGoals);

// PUT /driver/goals — save (or clear) this driver's weekly goals
const putGoals: RequestHandler = async (req: any, res: any) => {
  const user = req.user!;
  const body = req.body as { trips?: number | null; money?: number | null; moneyUrgent?: boolean | null } | null;
  const goals = body && (body.trips != null || body.money != null)
    ? {
        trips: body.trips != null && Number.isFinite(Number(body.trips)) && Number(body.trips) > 0 ? Number(body.trips) : null,
        money: body.money != null && Number.isFinite(Number(body.money)) && Number(body.money) > 0 ? Number(body.money) : null,
        moneyUrgent: body.moneyUrgent === true,
      }
    : null;
  await prisma.user.update({ where: { id: Number(user.id) }, data: { driverGoals: goals as any } });
  return res.json({ ok: true, goals });
};
router.put('/goals', putGoals);

/**
 * POST /driver/location
 * Body: { lat: number, lng: number }
 * Drivers can report their current location; we upsert into a driverLocation table when available.
 */
const postLocation: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  if (String(user.role || '').toUpperCase() !== 'DRIVER') {
    return res.status(403).json({ error: 'Driver access required' });
  }

  const locationSchema = z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      headingDeg: z.number().min(0).max(360).optional(),
      speedMps: z.number().min(0).max(120).optional(),
      accuracyM: z.number().min(0).max(10_000).optional(),
      transportBookingId: z.number().int().positive().optional(),
    })
    .strict();

  const parsed = locationSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  }
  const { lat, lng, headingDeg, speedMps, accuracyM, transportBookingId } = parsed.data;
  try {
    let linkedBooking: { id: number; userId: number; driverId: number | null; status: string } | null = null;
    if (typeof transportBookingId === "number") {
      linkedBooking = await prisma.transportBooking.findUnique({
        where: { id: transportBookingId },
        select: { id: true, userId: true, driverId: true, status: true },
      });
      if (!linkedBooking) return res.status(404).json({ error: "transport_booking_not_found" });
      if (!linkedBooking.driverId || Number(linkedBooking.driverId) !== Number(user.id)) {
        return res.status(403).json({ error: "not_assigned_to_you" });
      }
      if (linkedBooking.status === "CANCELED") {
        return res.status(409).json({ error: "trip_canceled" });
      }
    }

    if ((prisma as any).driverLiveLocation) {
      await (prisma as any).driverLiveLocation.upsert({
        where: { driverId: user.id },
        update: {
          lat,
          lng,
          headingDeg: typeof headingDeg === "number" ? Math.round(headingDeg) : undefined,
          speedMps: typeof speedMps === "number" ? speedMps : undefined,
          accuracyM: typeof accuracyM === "number" ? accuracyM : undefined,
          updatedAt: new Date(),
        },
        create: {
          driverId: user.id,
          lat,
          lng,
          headingDeg: typeof headingDeg === "number" ? Math.round(headingDeg) : undefined,
          speedMps: typeof speedMps === "number" ? speedMps : undefined,
          accuracyM: typeof accuracyM === "number" ? accuracyM : undefined,
        },
      });
    }

    // Optional history ping (only write when linked to a booking to avoid excessive growth)
    try {
      if ((prisma as any).driverLocationPing && linkedBooking) {
        await (prisma as any).driverLocationPing.create({
          data: {
            driverId: user.id,
            transportBookingId: linkedBooking.id,
            lat,
            lng,
            headingDeg: typeof headingDeg === "number" ? Math.round(headingDeg) : undefined,
            speedMps: typeof speedMps === "number" ? speedMps : undefined,
            accuracyM: typeof accuracyM === "number" ? accuracyM : undefined,
          },
        });
      }
    } catch (e) {
      // ignore ping write errors
    }
    // broadcast via socket.io if available
    try {
      const io = (req.app && (req.app as any).get && (req.app as any).get('io'));
      if (io && typeof io.to === 'function') {
        const payload = {
          driverId: user.id,
          transportBookingId: linkedBooking?.id ?? null,
          lat,
          lng,
          headingDeg,
          speedMps,
          accuracyM,
          at: new Date().toISOString(),
        };
        // Admin dispatch/map views
        io.to('admin').emit('driver:location:update', payload);
        // Driver can update their own UI if needed
        io.to(`driver:${user.id}`).emit('driver:location:update', payload);
        if (linkedBooking) {
          io.to(`transport:${linkedBooking.id}`).emit("transport:driver:location:update", payload);
          io.to(`user:${linkedBooking.userId}`).emit("transport:driver:location:update", payload);
        }
      }
    } catch (e) { /* ignore */ }
    res.json({ ok: true });
  } catch (e) {
    console.warn('driver.location upsert failed', e);
    res.status(500).json({ error: 'failed' });
  }
};
router.post('/location', limitDriverLocationUpdate, postLocation as unknown as RequestHandler);

/**
 * GET /driver/availability
 * Returns the authenticated driver's availability state.
 * This is the server source of truth (do not rely on localStorage across accounts).
 */
const getAvailability: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  if (String(user.role || '').toUpperCase() !== 'DRIVER') {
    return res.status(403).json({ error: 'Driver access required' });
  }

  try {
    let available = false;
    try {
      if ((prisma as any).driverAvailability) {
        const row = await (prisma as any).driverAvailability.findUnique({
          where: { driverId: user.id },
          select: { available: true },
        });
        available = Boolean(row?.available);
      } else if ((prisma as any).user) {
        const row = await prisma.user.findUnique({
          where: { id: user.id },
          select: { available: true, isAvailable: true } as any,
        });
        available = Boolean((row as any)?.available ?? (row as any)?.isAvailable ?? false);
      }
    } catch {
      // ignore and fall back to false
    }
    return res.json({ ok: true, available });
  } catch (e) {
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/availability', getAvailability as unknown as RequestHandler);

/**
 * POST /driver/availability
 * Body: { available: boolean }
 * Driver toggles their availability. Best-effort persistence: try a driverAvailability or user field, otherwise no-op.
 */
const postAvailability: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  if (String(user.role || '').toUpperCase() !== 'DRIVER') {
    return res.status(403).json({ error: 'Driver access required' });
  }

  const availabilitySchema = z.object({ available: z.boolean() }).strict();
  const parsed = availabilitySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  }
  const { available } = parsed.data;
  try {
    // Persist availability best-effort.
    // Prefer dedicated availability table if present; otherwise try user fields.
    try {
      if ((prisma as any).driverAvailability) {
        await (prisma as any).driverAvailability.upsert({
          where: { driverId: user.id },
          update: { available, updatedAt: new Date() },
          create: { driverId: user.id, available, updatedAt: new Date() },
        });
      } else if ((prisma as any).user) {
        // Try user.available first, then fall back to user.isAvailable.
        try {
          await prisma.user.update({ where: { id: user.id }, data: { available } as any });
        } catch (e1) {
          try {
            await prisma.user.update({ where: { id: user.id }, data: { isAvailable: available } as any });
          } catch {
            // ignore if schema doesn't have these fields
          }
        }
      }
    } catch {
      // ignore persistence errors
    }

    // broadcast availability change via socket.io for interested clients
    try {
      const io = (req.app && (req.app as any).get && (req.app as any).get('io'));
      if (io && typeof io.to === 'function') {
        // Also maintain the offer room membership for this driver (best-effort).
        try {
          const driverRoom = `driver:${user.id}`;
          if (available) {
            // Move all sockets for this driver into the available drivers room.
            (io as any).in(driverRoom)?.socketsJoin?.('drivers:available');
          } else {
            (io as any).in(driverRoom)?.socketsLeave?.('drivers:available');
          }
        } catch {
          // ignore
        }
        // Admin dispatch/map views
        io.to('admin').emit('driver:availability:update', { driverId: user.id, available });
        // Driver can update their own UI if needed
        io.to(`driver:${user.id}`).emit('driver:availability:update', { driverId: user.id, available });
      }
    } catch (e) { /* ignore */ }

    return res.json({ ok: true, available });
  } catch (e) {
    console.warn('driver.availability failed', e);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/availability', limitDriverAvailabilityToggle, postAvailability as unknown as RequestHandler);

/** PUT /driver/profile - update authenticated driver's profile (best-effort fields) */
const updateDriverProfile: RequestHandler = async (req, res) => {
  const {
    fullName,
    phone,
    nationality,
    avatarUrl,
    timezone,
    dateOfBirth,
    gender,
    nin,
    licenseNumber,
    plateNumber,
    vehicleType,
    vehicleMake,
    vehiclePlate,
    operationArea,
    paymentPhone,
    // Uploaded docs (Cloudinary URLs)
    drivingLicenseUrl,
    nationalIdUrl,
    latraUrl,
    insuranceUrl,
    // Optional extra fields (not always present in Prisma schema)
    region,
    district,
  } = req.body ?? {};
  const userId = (req as AuthedRequest).user!.id;
  const role = String((req as AuthedRequest).user?.role ?? "").trim().toUpperCase();

  const submittedDocumentUrls = [
    { field: 'drivingLicenseUrl', value: drivingLicenseUrl },
    { field: 'nationalIdUrl', value: nationalIdUrl },
    { field: 'latraUrl', value: latraUrl },
    { field: 'insuranceUrl', value: insuranceUrl },
  ];
  for (const submittedDocument of submittedDocumentUrls) {
    if (typeof submittedDocument.value !== 'string' || !submittedDocument.value.trim()) continue;
    if (!isTrustedUserDocumentUrl(submittedDocument.value, role)) {
      return res.status(400).json({
        error: 'invalid_document_url',
        message: `${submittedDocument.field} must point to approved NoLSAF-managed storage.`,
      });
    }
  }

  // Best-effort: only include fields if Prisma user model has them
  const meta = (prisma as any).user?._meta ?? {};
  // When _meta is unavailable (empty object), default hasField to true so all schema fields
  // are attempted; the P2022 error-retry below strips any truly unknown column.
  const metaHasEntries = Object.keys(meta).length > 0;
  const hasField = (field: string) => !metaHasEntries || Object.prototype.hasOwnProperty.call(meta, field);
  const beforeSelect: any = { };
  if (hasField('fullName')) beforeSelect.fullName = true;
  if (hasField('name')) beforeSelect.name = true;
  if (hasField('phone')) beforeSelect.phone = true;
  if (hasField('nationality')) beforeSelect.nationality = true;
  if (hasField('avatarUrl')) beforeSelect.avatarUrl = true;
  if (hasField('timezone')) beforeSelect.timezone = true;
  if (hasField('dateOfBirth')) beforeSelect.dateOfBirth = true;
  if (hasField('region')) beforeSelect.region = true;
  if (hasField('district')) beforeSelect.district = true;
  if (hasField('gender')) beforeSelect.gender = true;
  if (hasField('nin')) beforeSelect.nin = true;
  if (hasField('licenseNumber')) beforeSelect.licenseNumber = true;
  if (hasField('plateNumber')) beforeSelect.plateNumber = true;
  if (hasField('vehicleType')) beforeSelect.vehicleType = true;
  if (hasField('vehicleMake')) beforeSelect.vehicleMake = true;
  if (hasField('vehiclePlate')) beforeSelect.vehiclePlate = true;
  if (hasField('operationArea')) beforeSelect.operationArea = true;
  if (hasField('paymentPhone')) beforeSelect.paymentPhone = true;
  // We'll also load payout JSON to store extra fields safely
  if (hasField('payout')) beforeSelect.payout = true;

  let before: any = null;
  try { before = await prisma.user.findUnique({ where: { id: userId }, select: beforeSelect }); } catch (e) { /* ignore */ }

  const data: any = {};
  // Name fields
  if (hasField('fullName') && typeof fullName !== 'undefined') data.fullName = fullName;
  if (hasField('name') && typeof fullName !== 'undefined' && typeof data.fullName === 'undefined') data.name = fullName;

  // Core driver fields
  if (hasField('phone') && typeof phone !== 'undefined') data.phone = phone;
  if (hasField('nationality') && typeof nationality !== 'undefined') data.nationality = nationality;
  if (hasField('avatarUrl') && typeof avatarUrl !== 'undefined') data.avatarUrl = avatarUrl;
  if (hasField('timezone') && typeof timezone !== 'undefined') data.timezone = timezone;
  if (hasField('dateOfBirth') && typeof dateOfBirth !== 'undefined') data.dateOfBirth = dateOfBirth;
  if (hasField('region') && typeof region !== 'undefined') data.region = region;
  if (hasField('district') && typeof district !== 'undefined') data.district = district;
  if (hasField('gender') && typeof gender !== 'undefined') data.gender = gender;
  if (hasField('nin') && typeof nin !== 'undefined') data.nin = nin;
  if (hasField('licenseNumber') && typeof licenseNumber !== 'undefined') data.licenseNumber = licenseNumber;
  // Sync both plate fields: whichever is provided, keep them in sync
  if ((hasField('plateNumber') && typeof plateNumber !== 'undefined') ||
      (hasField('vehiclePlate') && typeof vehiclePlate !== 'undefined')) {
    const plateVal = plateNumber !== undefined ? plateNumber : vehiclePlate;
    data.plateNumber  = plateVal;
    data.vehiclePlate = plateVal;
  }
  if (hasField('vehicleType') && typeof vehicleType !== 'undefined') data.vehicleType = vehicleType;
  if (hasField('vehicleMake') && typeof vehicleMake !== 'undefined') data.vehicleMake = vehicleMake;
  if (hasField('operationArea') && typeof operationArea !== 'undefined') data.operationArea = operationArea;
  if (hasField('paymentPhone') && typeof paymentPhone !== 'undefined') data.paymentPhone = paymentPhone;
  // Resubmitting profile clears any outstanding admin note (driver has addressed it)
  if (hasField('kycNote')) data.kycNote = null;

  const extractUnknownArg = (err: any): string | null => {
    const msg = String(err?.message ?? '');
    const m = msg.match(/Unknown argument `([^`]+)`/);
    return m?.[1] ?? null;
  };

  let updated: any;
  try {
    updated = await prisma.user.update({ where: { id: userId }, data } as any);
  } catch (err: any) {
    const badField = extractUnknownArg(err);
    if (badField) {
      delete (data as any)[badField];
      updated = await prisma.user.update({ where: { id: userId }, data } as any);
    } else {
      console.error('driver.profile.update failed', err);
      return res.status(500).json({ error: 'failed' });
    }
  }

  // Persist extra fields to payout JSON for drivers when schema does not have dedicated columns
  try {
    // Only do this for drivers
    const role = String((req as AuthedRequest).user?.role ?? '').toUpperCase();
    if (role === 'DRIVER' && hasField('payout')) {
      const currentPayout = (before as any)?.payout;
      const payoutObj: any = (typeof currentPayout === 'object' && currentPayout !== null) ? { ...currentPayout } : {};
      const extras: any = (typeof payoutObj.profileExtras === 'object' && payoutObj.profileExtras !== null) ? { ...payoutObj.profileExtras } : {};
      if (typeof region !== 'undefined') extras.region = region;
      if (typeof district !== 'undefined') extras.district = district;
      if (typeof timezone !== 'undefined' && !hasField('timezone')) extras.timezone = timezone;
      if (typeof dateOfBirth !== 'undefined' && !hasField('dateOfBirth')) extras.dateOfBirth = dateOfBirth;
      payoutObj.profileExtras = extras;
      await prisma.user.update({ where: { id: userId }, data: { payout: payoutObj } as any });
    }
  } catch (e) {
    // ignore
  }

  // Persist document URLs into UserDocument (best-effort)
  const upsertDoc = async (type: string, url: string | undefined, metadata?: any) => {
    if (!url || typeof url !== 'string') return;
    if (!(prisma as any).userDocument) return;
    if (!isTrustedUserDocumentUrl(url, role)) {
      throw new Error(`Untrusted document URL for ${type}`);
    }
    const existing = await prisma.userDocument.findFirst({ where: { userId, type }, orderBy: { id: 'desc' } });
    if (existing) {
      await prisma.userDocument.update({ where: { id: existing.id }, data: { url, status: 'PENDING', metadata } as any });
    } else {
      await prisma.userDocument.create({ data: { userId, type, url, status: 'PENDING', metadata } as any });
    }
  };

  try {
    await upsertDoc('DRIVER_LICENSE', drivingLicenseUrl, {
      licenseNumber: typeof licenseNumber === 'string' ? licenseNumber : undefined,
      uploadedAt: new Date().toISOString(),
    });
    await upsertDoc('NATIONAL_ID', nationalIdUrl, {
      nin: typeof nin === 'string' ? nin : undefined,
      uploadedAt: new Date().toISOString(),
    });
    await upsertDoc('LATRA', latraUrl, {
      plateNumber: typeof plateNumber === 'string' ? plateNumber : undefined,
      vehicleType: typeof vehicleType === 'string' ? vehicleType : undefined,
      uploadedAt: new Date().toISOString(),
    });
    await upsertDoc('INSURANCE', insuranceUrl, { uploadedAt: new Date().toISOString() });
  } catch (e) {
    // Best-effort: don't fail the whole profile update
  }

  try { await audit(req as AuthedRequest, 'USER_PROFILE_UPDATE', `user:${updated.id}`, before, { ...data, drivingLicenseUrl, nationalIdUrl, latraUrl, insuranceUrl }); } catch (e) { /* ignore audit errors */ }
  return res.json({ ok: true });
};
router.put('/profile', updateDriverProfile as unknown as RequestHandler);

/**
 * Security endpoints for drivers
 * - POST /driver/security/password
 * - POST /driver/security/2fa
 *
 *
 * These implementations are best-effort / demo-friendly: if a prisma model exists
 * they attempt to perform updates, otherwise they return success or sample data.
 */
const postChangePassword: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const { currentPassword, newPassword } = req.body ?? {};
  
  // DoS protection: Enforce 8-12 character limit
  if (!newPassword || typeof newPassword !== 'string') { 
    res.status(400).json({ error: 'newPassword required' }); 
    return; 
  }
  
  if (newPassword.length < 8 || newPassword.length > 12) {
    return res.status(400).json({ 
      error: 'Password must be between 8 and 12 characters', 
      reasons: ['Password length must be between 8 and 12 characters to prevent DoS attacks'] 
    });
  }

  try {
    // Import shared password change security utilities from account.ts
    // For now, implement inline to avoid circular dependencies
    // Track password change attempts (shared with account endpoint would be ideal, but using local for now)
    interface PasswordChangeAttempt {
      failures: number;
      lastFailure: number;
      lockedUntil: number | null;
      lastSuccess: number | null;
    }
    const passwordChangeAttempts = new Map<number, PasswordChangeAttempt>();
    
    function getPasswordChangeAttempt(userId: number): PasswordChangeAttempt {
      if (!passwordChangeAttempts.has(userId)) {
        passwordChangeAttempts.set(userId, { failures: 0, lastFailure: 0, lockedUntil: null, lastSuccess: null });
      }
      return passwordChangeAttempts.get(userId)!;
    }

    const attempt = getPasswordChangeAttempt(user.id);
    const now = Date.now();
    
    // Check for timeout/lockout
    if (attempt.lockedUntil && now < attempt.lockedUntil) {
      const remaining = Math.ceil((attempt.lockedUntil - now) / 1000);
      return res.status(429).json({ 
        error: `Too many failed attempts. Please wait ${remaining} seconds.`,
        reasons: [`Account temporarily locked. Try again in ${remaining} seconds.`],
        lockedUntil: attempt.lockedUntil
      });
    }

    // Check 30-minute cooldown after successful password change
    if (attempt.lastSuccess && (now - attempt.lastSuccess) < (30 * 60 * 1000)) {
      const remaining = Math.ceil((30 * 60 * 1000 - (now - attempt.lastSuccess)) / 60000);
      return res.status(429).json({ 
        error: `Password was recently changed. Please wait ${remaining} minute(s) before changing it again.`,
        reasons: [`Password change cooldown active. Try again in ${remaining} minute(s).`],
        cooldownUntil: attempt.lastSuccess + (30 * 60 * 1000)
      });
    }

    // If a user table with a password/hash exists, attempt proper verification & hashing
    if ((prisma as any).user) {
      try {
        // Try passwordHash first (standard field), then fallback to password
        const u = await prisma.user.findUnique({ 
          where: { id: user.id }, 
          select: { passwordHash: true, password: true } as any 
        });
        const stored = (u as any)?.passwordHash ?? (u as any)?.password ?? null;

        // If a password exists, require currentPassword and verify
        if (stored) {
          if (!currentPassword || typeof currentPassword !== 'string') { 
            res.status(400).json({ error: 'currentPassword required' }); 
            return; 
          }

          let ok = false;
          try {
            // If stored value looks like an argon2 hash, verify with argon2
            if (typeof stored === 'string' && stored.startsWith('$argon2')) {
              ok = await argon2.verify(stored, currentPassword);
            } else {
              // fallback to plain compare
              ok = stored === currentPassword;
            }
          } catch (e) {
            ok = false;
          }

          if (!ok) {
            // Track failure
            attempt.failures += 1;
            attempt.lastFailure = now;
            
            // Lock after 3 consecutive failures for 5 minutes
            if (attempt.failures >= 3) {
              attempt.lockedUntil = now + (5 * 60 * 1000); // 5 minutes
              attempt.failures = 0; // Reset counter after lockout
              return res.status(429).json({ 
                error: "Too many failed attempts. Account locked for 5 minutes.",
                reasons: ['Account temporarily locked due to multiple failed password change attempts.'],
                lockedUntil: attempt.lockedUntil
              });
            }
            
            return res.status(400).json({ 
              error: 'current password is incorrect',
              reasons: [`Incorrect current password. ${3 - attempt.failures} attempt(s) remaining before lockout.`]
            });
          }
        }

        // Reset failure counter on successful password verification
        attempt.failures = 0;
        attempt.lockedUntil = null;

        // Enforce policy: Prevent reusing the current/existing password
        if (stored) {
          let isCurrentPassword = false;
          try {
            if (typeof stored === 'string' && stored.startsWith('$argon2')) {
              isCurrentPassword = await argon2.verify(stored, newPassword);
            } else {
              isCurrentPassword = stored === newPassword;
            }
          } catch (e) {
            isCurrentPassword = false;
          }
          
          if (isCurrentPassword) {
            return res.status(400).json({ 
              error: "Cannot reuse current password", 
              reasons: ['The new password must be different from your current password. Please choose a different password.'] 
            });
          }
        }

        // Validate strength before hashing using SystemSetting configuration
        try {
          const { valid, reasons } = await validatePasswordWithSettings(newPassword, (user as any).role);
          if (!valid) {
            res.status(400).json({ error: 'Password does not meet strength requirements', reasons });
            return;
          }

          // Prevent reuse of recent passwords from history
          const reused = await isPasswordReused(user.id, newPassword);
          if (reused) {
            return res.status(400).json({ 
              error: "Password was used recently", 
              reasons: ['This password was used recently. Please choose a different password that has not been used before.'] 
            });
          }

          const hash = await argon2.hash(newPassword);
          // Try passwordHash first, then fallback to password
          const updateData: any = {};
          try {
            updateData.passwordHash = hash;
          } catch (e) {
            updateData.password = hash;
          }
          await prisma.user.update({ where: { id: user.id }, data: updateData as any });
          
          // Record the new hash in password history (best-effort)
          try {
            await addPasswordToHistory(user.id, hash);
          } catch (e) {
            // Best-effort
          }
          
          // Record successful password change and set cooldown
          attempt.lastSuccess = now;
          attempt.failures = 0;
          attempt.lockedUntil = null;
          
          return res.json({ ok: true, message: 'Password changed successfully', cooldownUntil: now + (30 * 60 * 1000) });
        } catch (e) {
          // if update fails, fall through to generic success to avoid leaking implementation
        }
      } catch (e) {
        // ignore and fallthrough
      }
    }

    // Fallback: no prisma user model or persistence failed — return success for demo
    return res.json({ ok: true });
  } catch (err) {
    console.warn('driver.security.password failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/security/password', blockImpersonated as unknown as RequestHandler, postChangePassword as unknown as RequestHandler);

/**
 * GET /driver/security/2fa
 * Returns status for available 2FA methods (TOTP/SMS) and a masked phone when available.
 */
const get2faStatus: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    let totpEnabled = false;
    let smsEnabled = false;
    let phone: string | null = null;
    try {
      if ((prisma as any).user) {
        const u = await prisma.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true, twoFactorMethod: true, phone: true } as any });
        if (u) {
          const twoFactorEnabled = !!(u as any).twoFactorEnabled || false;
          const twoFactorMethod = (u as any).twoFactorMethod || null;
          totpEnabled = twoFactorEnabled && twoFactorMethod === 'TOTP';
          smsEnabled = twoFactorEnabled && twoFactorMethod === 'SMS';
          phone = (u as any).phone ?? null;
        }
      }
    } catch (e) {
      // ignore and fallthrough to demo values
    }

    // Mask phone for privacy
    const maskedPhone = phone ? phone.replace(/.(?=.{4})/g, '*') : null;
    return res.json({ totpEnabled, smsEnabled, phone: maskedPhone });
  } catch (err) {
    console.warn('driver.security.2fa.status failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/security/2fa', get2faStatus as unknown as RequestHandler);


/**
 * POST /driver/security/2fa
 * Body: { type?: 'totp'|'sms', action: 'enable'|'disable', code?: string, phone?: string }
 * Best-effort implementation: updates user flags if fields exist; returns updated statuses.
 */
const postToggle2fa: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!user) { res.status(401).json({ error: 'unauthenticated' }); return; }
  const { action, type, code, phone } = req.body ?? {};
  if (!action || (action !== 'enable' && action !== 'disable')) { res.status(400).json({ error: 'action must be enable or disable' }); return; }
  try {
    let totpEnabled = false;
    let smsEnabled = false;

    // Best-effort: update user record fields when present
    if ((prisma as any).user) {
      try {
        const updateData: any = {};
        if (type === 'sms') {
          // attempt to update sms2faEnabled and phone fields if they exist
          if (action === 'enable') {
            updateData.sms2faEnabled = true;
            if (phone) updateData.phone = phone; // phone is a core schema field — always include
          } else {
            updateData.sms2faEnabled = false;
          }
        } else if (type === 'totp') {
          // TOTP flow: verify the provided code against stored secret (best-effort)
          if (action === 'enable') {
            // need a code to verify
            if (!code || typeof code !== 'string') { res.status(400).json({ error: 'code required for TOTP enable' }); return; }

            // try to read stored secret from DB only if the prisma model supports it
            let storedSecret: string | null = null;
            try {
              // totpSecret is in the schema — attempt unconditionally, catch P2022 if column missing
              const u = await prisma.user.findUnique({ where: { id: user.id }, select: { totpSecret: true } as any });
              storedSecret = (u as any)?.totpSecret ?? null;
            } catch (e) { /* ignore read errors — column may not exist in this DB */ }

            // fallback: accept secret passed in body (not ideal for prod)
            const secretToCheck = storedSecret || (req.body && typeof req.body.secret === 'string' ? req.body.secret : null);
            if (!secretToCheck) { res.status(400).json({ error: 'no totp secret available; provision first' }); return; }

            // validate code
            let ok = false;
            try { ok = authenticator.check(String(code), String(secretToCheck)); } catch (e) { ok = false; }
            if (!ok) { res.status(400).json({ error: 'invalid TOTP code' }); return; }

            // verification passed: mark enabled and persist flag
            updateData.twoFactorEnabled = true;
            updateData.twoFactorMethod = 'TOTP';
          } else {
            updateData.twoFactorEnabled = false;
            updateData.twoFactorMethod = null;
          }
        } else {
          // no specific type provided: toggle the generic twoFactorEnabled flag
          updateData.twoFactorEnabled = action === 'enable';
        }

        // Only attempt update if updateData is non-empty
        if (Object.keys(updateData).length > 0) {
          try {
            await prisma.user.update({ where: { id: user.id }, data: updateData as any });
          } catch (e) {
            // ignore persistence errors
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // Construct response status guesses
    try {
      const u = (prisma as any).user ? await prisma.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true, sms2faEnabled: true } as any }) : null;
      totpEnabled = !!(u && (u as any).twoFactorEnabled);
      smsEnabled = !!(u && (u as any).sms2faEnabled);
    } catch (e) {
      // best-effort fallback to action
      if (type === 'sms') smsEnabled = action === 'enable';
      else totpEnabled = action === 'enable';
    }

    return res.json({ ok: true, totpEnabled, smsEnabled });
  } catch (err) {
    // Improved logging for debugging: print stack when available
    try {
      const ex: any = err;
      console.error('driver.security.2fa failed', ex && (ex.stack || ex.message || ex));
    } catch (e) { console.error('driver.security.2fa failed (logging error)', e); }
    const details = ((err as any) && ((err as any).message || String(err))) || 'failed';
    // Return error details to the client to aid debugging in development.
    // In production you may want to hide `details`.
    return res.status(500).json({ error: 'failed', details });
  }
};
router.post('/security/2fa', blockImpersonated as unknown as RequestHandler, postToggle2fa as unknown as RequestHandler);


/**
 * GET /driver/security/2fa/provision?type=totp
 * Returns an otpauth URL and QR data URL for provisioning an authenticator app.
 * Best-effort: stores the secret on the user record if a 'totpSecret' field exists.
 */
const get2faProvision: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!user) { res.status(401).json({ error: 'unauthenticated' }); return; }
  const type = (req.query.type as string) || 'totp';
  if (type !== 'totp') { res.status(400).json({ error: 'unsupported type' }); return; }
  try {
    const secret = authenticator.generateSecret();
    const account = ((user as any).email || `user-${user.id}`) as string;
    const service = process.env.APP_NAME || 'nolsaf';
    const otpauth = authenticator.keyuri(account, service, secret);
    let qr: string | null = null;
    try { qr = await qrcode.toDataURL(otpauth); } catch (e) { /* ignore qr generation errors */ }

    // Attempt to persist secret to user record (totpSecret is in schema — let try-catch handle missing column)
    try {
      await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } as any });
    } catch (e) { /* ignore persistence errors — column may not exist in this DB */ }

    return res.json({ secret, otpauth, qr });
  } catch (err) {
    console.warn('driver.security.2fa.provision failed', err);
    const details = ((err as any) && ((err as any).message || String(err))) || 'failed';
    return res.status(500).json({ error: 'failed', details });
  }
};
router.get('/security/2fa/provision', get2faProvision as unknown as RequestHandler);

// Sessions endpoints removed — Active sessions feature deprecated/removed

/**
 * GET /driver/security/logins
 * Returns a small list of recent login attempts for the driver (best-effort/demo).
 */
const getLoginHistory: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    // Try to use a prisma login/session audit model if present
    if ((prisma as any).loginAttempt) {
      try {
        const items = await (prisma as any).loginAttempt.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
        const mapped = (items || []).map((it: any) => ({
          id: it.id,
          at: it.createdAt,
          ip: it.ip,
          username: it.username ?? null,
          platform: it.platform ?? null,
          details: it.userAgent ?? null,
          timeUsed: typeof it.duration === 'number' ? it.duration : (it.timeUsedSeconds ?? null),
          success: typeof it.success === 'boolean' ? it.success : null,
        }));
        return res.json({ records: mapped });
      } catch (e) { /* ignore and fallthrough */ }
    }

    // Prefer AuditLog entries written by auth flows (USER_LOGIN/USER_LOGOUT). This is the closest thing
    // to a real login history in this codebase and includes IP + user-agent.
    if ((prisma as any).auditLog) {
      try {
        const audits = await (prisma as any).auditLog.findMany({
          where: { actorId: user.id, action: { in: ['USER_LOGIN', 'USER_LOGOUT'] } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        const mapped = (audits || []).map((it: any) => {
          const ua = typeof it.ua === 'string' ? it.ua : '';
          const after = it.afterJson as any;
          const method = after && typeof after.loginMethod === 'string' ? after.loginMethod : null;
          const event = after && typeof after.event === 'string' ? after.event : (it.action === 'USER_LOGOUT' ? 'logout' : 'login');
          const ok = after && typeof after.success === 'boolean' ? after.success : (it.action === 'USER_LOGIN' ? true : true);
          const detailsParts = [
            event ? `Event: ${event}` : null,
            method ? `Method: ${method}` : null,
            ua ? `UA: ${ua}` : null,
          ].filter(Boolean);
          return {
            id: String(it.id),
            at: it.createdAt,
            ip: it.ip ?? null,
            username: after?.email ?? (user as any)?.email ?? null,
            platform: inferPlatformFromUserAgent(ua),
            details: detailsParts.length ? detailsParts.join('\n') : null,
            timeUsed: null,
            success: ok,
          };
        });
        return res.json({ records: mapped });
      } catch (e) {
        // ignore and fallthrough
      }
    }

    // Fallback/demo data with richer fields
    const demo = [
      { id: 'l1', at: new Date().toISOString(), ip: '127.0.0.1', username: 'driver1', platform: 'Windows', details: 'Browser: Chrome -- Version: 142.0.0.0', timeUsed: 3600, success: true },
      { id: 'l2', at: new Date(Date.now() - 3600 * 1000).toISOString(), ip: '127.0.0.2', username: 'driver1', platform: 'iOS', details: 'Browser: Safari -- Version: 18.2', timeUsed: 45, success: false },
      { id: 'l3', at: new Date(Date.now() - 86400 * 1000).toISOString(), ip: '127.0.0.3', username: 'driver1', platform: 'Android', details: 'App: nolsaf Android -- Version: 3.4.1', timeUsed: 7200, success: true },
    ];
    return res.json({ records: demo });
  } catch (err) {
    console.warn('driver.security.logins failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/security/logins', getLoginHistory as unknown as RequestHandler);

function inferPlatformFromUserAgent(ua: string) {
  const s = String(ua || '').toLowerCase();
  if (!s) return null;
  if (s.includes('windows')) return 'Windows';
  if (s.includes('android')) return 'Android';
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) return 'iOS';
  if (s.includes('mac os x') || s.includes('macintosh')) return 'macOS';
  if (s.includes('linux')) return 'Linux';
  return 'Unknown';
}

/**
 * Passkeys endpoints using @simplewebauthn/server for registration verification.
 * - GET /driver/security/passkeys -> list registered passkeys
 * - POST /driver/security/passkeys -> create registration options (publicKey)
 * - POST /driver/security/passkeys/verify -> verify attestation and store credential
 * - DELETE /driver/security/passkeys/:id -> remove credential
 */
const getPasskeys: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    // Try prisma model if present
    if ((prisma as any).passkey) {
      try {
        const items = await (prisma as any).passkey.findMany({ where: { userId: user.id } });
        return res.json({ items: (items || []).map((it: any) => ({ id: it.id, name: it.name ?? 'passkey', createdAt: it.createdAt })) });
      } catch (e) { /* ignore */ }
    }

    // Fallback to in-memory store
    const items = passkeyStore.get(String(user.id)) || [];
    return res.json({ items });
  } catch (err) {
    console.warn('driver.security.passkeys.list failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.get('/security/passkeys', getPasskeys as unknown as RequestHandler);

const postPasskeysCreate: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const { rpID } = getWebAuthnRp();

    // load existing credentials to exclude
    let excludeCredentials: Array<any> = [];
    try {
      if ((prisma as any).passkey) {
        const existing = await (prisma as any).passkey.findMany({ where: { userId: user.id } });
        excludeCredentials = (existing || []).map((c: any) => ({ id: c.credentialId, type: 'public-key' }));
      } else {
        const existing = passkeyStore.get(String(user.id)) || [];
        excludeCredentials = existing.map((c: any) => ({ id: c.id, type: 'public-key' }));
      }
    } catch (e) { /* ignore */ }

    const options = await generateRegistrationOptions({
      rpName: process.env.APP_NAME || 'nolsaf',
      rpID,
      userID: String(user.id),
      userName: (user as any).email || `user-${user.id}`,
      timeout: 60000,
      attestationType: 'direct',
      // residentKey makes the credential discoverable so it can be used for
      // username-less login (/api/auth/passkeys/options with no allowCredentials).
      authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
      excludeCredentials,
    });

    // store challenge for verification (base64url)
    await setDriverPasskeyChallenge(user.id, options.challenge as string);

    return res.json({ publicKey: options });
  } catch (err) {
    console.warn('driver.security.passkeys.create failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/security/passkeys', blockImpersonated as unknown as RequestHandler, postPasskeysCreate as unknown as RequestHandler);

const postPasskeysVerify: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const body = (req.body ?? {}) as any;
    const name = body?.name;

    // The Web app may send the full credential JSON at the top-level (id/rawId/response/...)
    // or nest it under `response`. Normalize to a RegistrationResponseJSON-like object.
    const credential = (() => {
      // If body already looks like a registration response
      if (body && typeof body === 'object' && typeof body.id === 'string' && body.response) return body;
      // If body.response is the full credential
      if (body && typeof body === 'object' && body.response && typeof body.response.id === 'string') return body.response;
      // If body has id/rawId but response is nested (common in our web page)
      if (body && typeof body === 'object' && typeof body.id === 'string' && typeof body.rawId === 'string' && body.response) {
        return {
          id: body.id,
          rawId: body.rawId,
          response: body.response,
          type: body.type ?? 'public-key',
          clientExtensionResults: body.clientExtensionResults ?? {},
        };
      }
      return null;
    })();

    if (!credential) {
      return res.status(400).json({
        error: 'invalid payload',
        hint: 'Expected WebAuthn registration response JSON (id/rawId/response/type/clientExtensionResults).',
      });
    }

    const storedChallenge = await getDriverPasskeyChallenge(user.id);
    if (!storedChallenge) { res.status(400).json({ error: 'no challenge found' }); return; }

    const { rpID, expectedOrigins } = getWebAuthnRp();

    let verification: any = null;
    try {
      // simplewebauthn types are strict; cast to any to accept the browser-shaped response
      verification = await (verifyRegistrationResponse as any)({
        response: credential,
        expectedChallenge: storedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        // Our registration options use `userVerification: 'preferred'`.
        // Don't hard-fail registration if a platform/roaming authenticator doesn't assert UV.
        requireUserVerification: false,
      } as any);
    } catch (e) {
      console.warn('webauthn verification error', e);
      const details = process.env.NODE_ENV !== 'production' ? String((e as any)?.message ?? e) : undefined;
      return res.status(400).json({ error: 'verification failed', ...(details ? { details } : {}) });
    }

    if (!verification || !verification.verified) {
      return res.status(400).json({ error: 'verification failed' });
    }

    // One-time challenge: clear after successful verification to prevent replay.
    try { await deleteDriverPasskeyChallenge(user.id); } catch { /* ignore */ }

    const regInfo = verification.registrationInfo;
    if (!regInfo || !regInfo.credentialID || !regInfo.credentialPublicKey) {
      return res.status(500).json({ error: 'missing registration info' });
    }

    const credentialId = toBase64Url(Buffer.from(regInfo.credentialID));
    const publicKey = toBase64Url(Buffer.from(regInfo.credentialPublicKey));
    const signCount = typeof regInfo.counter === 'number' ? regInfo.counter : 0;

    // persist credential
    if ((prisma as any).passkey) {
      try {
        const rec = await (prisma as any).passkey.create({ data: { userId: user.id, credentialId, publicKey, signCount, name: name ?? 'passkey' } });
        return res.json({ ok: true, item: { id: rec.id, name: rec.name, createdAt: rec.createdAt } });
      } catch (e) { /* ignore DB save errors and fallback to memory */ }
    }

    const item = { id: credentialId, name: name ?? 'passkey', createdAt: new Date().toISOString(), publicKey, signCount };
    const list = passkeyStore.get(String(user.id)) || [];
    list.unshift(item);
    passkeyStore.set(String(user.id), list);
    return res.json({ ok: true, item });
  } catch (err) {
    console.warn('driver.security.passkeys.verify failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/security/passkeys/verify', blockImpersonated as unknown as RequestHandler, postPasskeysVerify as unknown as RequestHandler);

/**
 * POST /driver/security/passkeys/authenticate
 * Body: none
 * Returns authentication options for navigator.credentials.get
 */
const postPasskeysAuthenticate: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const { rpID } = getWebAuthnRp();

    // load existing credentials to allow
    let allowCredentials: Array<any> = [];
    try {
      if ((prisma as any).passkey) {
        const existing = await (prisma as any).passkey.findMany({ where: { userId: user.id } });
        allowCredentials = (existing || []).map((c: any) => ({ id: c.credentialId, type: 'public-key' }));
      } else {
        const existing = passkeyStore.get(String(user.id)) || [];
        allowCredentials = existing.map((c: any) => ({ id: c.id, type: 'public-key' }));
      }
    } catch (e) { /* ignore */ }

    const options = await generateAuthenticationOptions({
      timeout: 60000,
      rpID,
      userVerification: 'preferred',
      allowCredentials,
    });
    await setDriverPasskeyChallenge(user.id, (options as any).challenge as string);
    return res.json({ publicKey: options });
  } catch (err) {
    console.warn('driver.security.passkeys.authenticate failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/security/passkeys/authenticate', postPasskeysAuthenticate as unknown as RequestHandler);

/**
 * POST /driver/security/passkeys/authenticate/verify
 * Body: { response }
 * Verifies an authentication assertion and updates signCount
 */
const postPasskeysAuthenticateVerify: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const body = req.body ?? {};
    const { response } = body as any;
    if (!response) { res.status(400).json({ error: 'invalid payload' }); return; }

    const storedChallenge = await getDriverPasskeyChallenge(user.id);
    if (!storedChallenge) { res.status(400).json({ error: 'no challenge found' }); return; }

    // find credential
    const credId = response.id || response.rawId;
    if (!credId) { res.status(400).json({ error: 'missing credential id' }); return; }

    let stored: any = null;
    try {
      if ((prisma as any).passkey) {
        stored = await (prisma as any).passkey.findFirst({ where: { OR: [{ credentialId: credId }, { id: credId }] } });
      } else {
        const list = passkeyStore.get(String(user.id)) || [];
        stored = list.find((c: any) => c.id === credId || c.credentialId === credId) || null;
      }
    } catch (e) { /* ignore */ }

    if (!stored) { res.status(400).json({ error: 'credential not found' }); return; }

    const publicKey = stored.publicKey;
    const signCount = typeof stored.signCount === 'number' ? stored.signCount : (stored.sign_count ?? 0);

    const { rpID, expectedOrigins } = getWebAuthnRp();

    let verification: any = null;
    try {
      verification = await (verifyAuthenticationResponse as any)({
        response,
        expectedChallenge: storedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        authenticator: {
          credentialPublicKey: fromBase64Url(publicKey),
          credentialID: fromBase64Url(stored.credentialId || stored.id),
          counter: signCount,
        },
      } as any);
    } catch (e) {
      console.warn('webauthn auth verification error', e);
      return res.status(400).json({ error: 'verification failed' });
    }

    if (!verification || !verification.verified) return res.status(400).json({ error: 'verification failed' });

    // one challenge per assertion; matches the account.ts flow
    await deleteDriverPasskeyChallenge(user.id);

    const newCounter = (verification.authenticationInfo && (verification.authenticationInfo.newCounter ?? verification.authenticationInfo.counter)) ?? null;
    if (typeof newCounter === 'number') {
      try {
        if ((prisma as any).passkey) {
          await (prisma as any).passkey.update({ where: { credentialId: stored.credentialId || stored.id }, data: { signCount: newCounter } });
        } else {
          const list = passkeyStore.get(String(user.id)) || [];
          const idx = list.findIndex((c: any) => c.id === (stored.credentialId || stored.id));
          if (idx >= 0) { list[idx].signCount = newCounter; passkeyStore.set(String(user.id), list); }
        }
      } catch (e) { /* ignore update errors */ }
    }

    return res.json({ ok: true, verified: true });
  } catch (err) {
    console.warn('driver.security.passkeys.authenticate.verify failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.post('/security/passkeys/authenticate/verify', postPasskeysAuthenticateVerify as unknown as RequestHandler);

const deletePasskey: RequestHandler = async (req, res) => {
  const user = (req as AuthedRequest).user!;
  try {
    const id = req.params[0] || req.params.id || (req as any).params.id;
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    if ((prisma as any).passkey) {
      try {
        // attempt to delete by primary id first, then by credentialId
        try { await (prisma as any).passkey.delete({ where: { id } }); return res.json({ ok: true }); } catch (e) { /* ignore */ }
        try { await (prisma as any).passkey.delete({ where: { credentialId: id } }); return res.json({ ok: true }); } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    }
    const list = (passkeyStore.get(String(user.id)) || []).filter((k: any) => k.id !== id);
    passkeyStore.set(String(user.id), list);
    return res.json({ ok: true });
  } catch (err) {
    console.warn('driver.security.passkeys.delete failed', err);
    return res.status(500).json({ error: 'failed' });
  }
};
router.delete('/security/passkeys/:id', blockImpersonated as unknown as RequestHandler, deletePasskey as unknown as RequestHandler);

export default router;
