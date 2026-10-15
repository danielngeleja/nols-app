import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function displayName(user: any, fallback = "Unknown user") {
  return String(user?.fullName || user?.name || user?.email || fallback).trim();
}

function operatorName(booking: any) {
  const snapshot = safeObject(booking.operatorSnapshot);
  const profile = safeObject(booking.operator?.operatorProfile);
  return String(
    snapshot.companyName ||
    profile.companyName ||
    booking.operator?.user?.fullName ||
    booking.operator?.user?.name ||
    "Tour operator"
  );
}

function isPickupValidated(metadata: unknown): boolean {
  const md = safeObject(metadata);
  const shared = safeObject(md.pickupValidation);
  const operator = safeObject(md.pickupValidationOperator);
  const customer = safeObject(md.pickupValidationCustomer);
  return Boolean(
    shared.validated ||
    shared.firstMeetValidated ||
    shared.validatedAt ||
    operator.validated ||
    operator.validatedAt ||
    customer.validated ||
    customer.validatedAt
  );
}

function pickupValidatedAt(metadata: unknown): string | null {
  const md = safeObject(metadata);
  return String(
    safeObject(md.pickupValidationCustomer).validatedAt ||
    safeObject(md.pickupValidationOperator).validatedAt ||
    safeObject(md.pickupValidation).validatedAt ||
    ""
  ).trim() || null;
}

function timelineRows(packageSnapshot: unknown, metadata: unknown): any[] {
  const pkg = safeObject(packageSnapshot);
  const md = safeObject(metadata);
  const candidates = [pkg.itinerary, md.itinerary, pkg.timelineDays, md.timelineDays];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function timelineEvents(packageSnapshot: unknown, metadata: unknown) {
  return timelineRows(packageSnapshot, metadata).flatMap((row: any, idx: number) => {
    const day = Number(row?.day) > 0 ? Number(row.day) : idx + 1;
    const slots = [
      ...(Array.isArray(row?.events) ? row.events : []),
      ...(Array.isArray(row?.timeline) ? row.timeline : []),
    ];
    const rows = slots.length ? slots : [row];
    return rows.map((slot: any, slotIdx: number) => {
      const start = String(slot?.startTime || slot?.from || "").trim();
      const end = String(slot?.endTime || slot?.to || "").trim();
      const time = String(slot?.timeRange || slot?.time || (start && end ? `${start} - ${end}` : start || end) || "").trim();
      const title = String(slot?.activity || slot?.label || slot?.title || slot?.name || row?.title || row?.name || "Activity details").trim();
      return {
        key: `${day}-${slotIdx}`,
        axisLabel: `D${day}.${slotIdx + 1}`,
        day,
        slotIndex: slotIdx,
        time,
        title,
        vibe: String(slot?.experienceVibe || slot?.vibe || slot?.mood || "").trim(),
      };
    });
  });
}

function ratingForUser(entry: unknown, userId: number): number {
  const eventEntry = safeObject(entry);
  const ratings = safeObject(eventEntry.ratings);
  const userRating = ratings[String(userId)];
  if (userRating) return Number(safeObject(userRating).rating || userRating || 0);
  if (Number(eventEntry.ratedByUserId || 0) === Number(userId)) return Number(eventEntry.rating || 0);
  return 0;
}

function parseEventKey(value: string): { day: number; slotIndex: number } {
  const match = String(value || "").trim().match(/^(\d+)-(\d+)$/);
  if (!match) return { day: 0, slotIndex: 0 };
  return { day: Number(match[1] || 0), slotIndex: Number(match[2] || 0) };
}

function ratingLabel(value: number): string {
  if (value >= 4.75) return "Beyond expectations";
  if (value >= 3.75) return "Excited";
  if (value >= 2.75) return "Good";
  if (value >= 1.75) return "Okay";
  return value > 0 ? "Bored" : "Waiting";
}

function participantStatus(value: unknown): string {
  return String(value || "ACCEPTED").trim().toUpperCase();
}

function isJoinedParticipant(value: unknown): boolean {
  const status = participantStatus(value);
  return status === "ACCEPTED" || status === "JOINED";
}

type JoinedParticipantEntry = { userId: number; acceptedAt: string | null };

function joinedParticipantsFromMetadata(metadata: unknown): JoinedParticipantEntry[] {
  const md = safeObject(metadata);
  const byUser = new Map<number, JoinedParticipantEntry>();

  // Primary source: explicit participant records.
  for (const entry of safeArray(md.timelineParticipants)) {
    const userId = Number(entry?.userId || 0);
    if (userId <= 0) continue;
    if (!isJoinedParticipant(entry?.status)) continue;
    byUser.set(userId, {
      userId,
      acceptedAt: String(entry?.acceptedAt || "").trim() || null,
    });
  }

  // Fallback source: invite acceptance ledger in metadata.timelineInvites[].acceptedByUserIds.
  for (const invite of safeArray(md.timelineInvites)) {
    const acceptedAt = String(invite?.lastAcceptedAt || invite?.updatedAt || invite?.createdAt || "").trim() || null;
    for (const rawId of safeArray(invite?.acceptedByUserIds)) {
      const userId = Number(rawId || 0);
      if (userId <= 0) continue;
      if (!byUser.has(userId)) {
        byUser.set(userId, { userId, acceptedAt });
      }
    }
  }

  return [...byUser.values()];
}

function ratingContributorUserIds(ratingsValue: unknown): number[] {
  const ratingsRoot = safeObject(ratingsValue);
  const ids = new Set<number>();

  for (const rawEntry of Object.values(ratingsRoot)) {
    const entry = safeObject(rawEntry);
    const multi = safeObject(entry.ratings);
    for (const rawKey of Object.keys(multi)) {
      const id = Number(rawKey);
      if (id > 0) ids.add(id);
    }

    // Legacy single-rating shape.
    const legacyId = Number(entry.ratedByUserId || 0);
    if (legacyId > 0 && Number(entry.rating || 0) >= 1) ids.add(legacyId);
  }

  return [...ids];
}

function summarizeRatings(booking: any, participantUsers: Map<number, any>) {
  const generatedEvents = timelineEvents(booking.packageSnapshot, booking.metadata);
  const md = safeObject(booking.metadata);
  const ratings = safeObject(md.timelineEventRatings);
  const generatedByKey = new Map<string, any>(generatedEvents.map((event) => [String(event.key), event]));
  const ratingKeys = Object.keys(ratings).map((key) => String(key || "").trim()).filter(Boolean);
  const allKeys = [...new Set([...generatedByKey.keys(), ...ratingKeys])];
  const events = allKeys
    .map((key) => {
      const existing = generatedByKey.get(key);
      if (existing) return existing;
      const parsed = parseEventKey(key);
      const ratingEntry = safeObject(ratings[key]);
      return {
        key,
        axisLabel: parsed.day > 0 ? `D${parsed.day}.${parsed.slotIndex + 1}` : key,
        day: parsed.day,
        slotIndex: parsed.slotIndex,
        time: String(ratingEntry.time || "").trim(),
        title: String(ratingEntry.title || `Activity ${key}`).trim(),
        vibe: String(ratingEntry.vibe || "").trim(),
      };
    })
    .sort((a, b) => Number(a.day || 0) - Number(b.day || 0) || Number(a.slotIndex || 0) - Number(b.slotIndex || 0));

  const ownerId = Number(booking.customerId || 0);
  const participantIds = joinedParticipantsFromMetadata(booking.metadata)
    .map((entry) => entry.userId)
    .filter((id) => id > 0);
  const contributorIds = ratingContributorUserIds(md.timelineEventRatings);
  const userIds = [...new Set([ownerId, ...participantIds, ...contributorIds].filter((id) => id > 0))];

  const userCompletion = userIds.map((userId) => {
    const ratedEvents = events.filter((event) => ratingForUser(ratings[event.key], userId) >= 1).length;
    const user = userId === ownerId ? booking.customer : participantUsers.get(userId);
    return {
      userId,
      name: displayName(user, userId === ownerId ? "Booking owner" : `Traveller #${userId}`),
      role: userId === ownerId ? "OWNER" : "TRAVELLER",
      ratedEvents,
      totalEvents: events.length,
      complete: events.length > 0 && ratedEvents >= events.length,
    };
  });

  const eventPoints = events.map((event) => {
    const values = userIds
      .map((userId) => ratingForUser(ratings[event.key], userId))
      .filter((rating) => rating >= 1 && rating <= 5);
    const average = values.length ? values.reduce((sum, rating) => sum + rating, 0) / values.length : 0;
    return {
      ...event,
      average: Number(average.toFixed(2)),
      ratingCount: values.length,
      label: ratingLabel(average),
    };
  });
  const ratedPoints = eventPoints.filter((point) => point.ratingCount > 0);
  const totalRatings = ratedPoints.reduce((sum, point) => sum + point.ratingCount, 0);
  const weightedAverage = totalRatings
    ? ratedPoints.reduce((sum, point) => sum + point.average * point.ratingCount, 0) / totalRatings
    : 0;
  const highest = ratedPoints.reduce<any | null>((best, point) => (!best || point.average > best.average ? point : best), null);
  const lowest = ratedPoints.reduce<any | null>((low, point) => (!low || point.average < low.average ? point : low), null);

  return {
    totalEvents: events.length,
    totalRatings,
    averageRating: Number(weightedAverage.toFixed(2)),
    topFeeling: ratingLabel(weightedAverage),
    highest,
    lowest,
    eventPoints,
    userCompletion,
    completedTravellers: userCompletion.filter((user) => user.complete).length,
  };
}

router.get("/overview", (async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "ALL").trim().toUpperCase();
    const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200)));

    const bookings = await prisma.tourBooking.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        bookingCode: true,
        title: true,
        destination: true,
        packageId: true,
        packageSnapshot: true,
        operatorSnapshot: true,
        operatorAgentId: true,
        customerId: true,
        travelerCount: true,
        status: true,
        paymentStatus: true,
        startDate: true,
        endDate: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { id: true, fullName: true, name: true, email: true } },
        operator: {
          select: {
            id: true,
            operatorProfile: true,
            user: { select: { fullName: true, name: true, email: true } },
          },
        },
      },
    });

    const participantUserIds = [
      ...new Set(
        bookings.flatMap((booking) => {
          const md = safeObject(booking.metadata);
          const ownerId = Number(booking.customerId || 0);
          const joinedIds = joinedParticipantsFromMetadata(booking.metadata).map((entry) => Number(entry.userId || 0));
          const contributorIds = ratingContributorUserIds(md.timelineEventRatings).filter((userId) => userId !== ownerId);
          return [...joinedIds, ...contributorIds];
        }).filter((id) => id > 0)
      ),
    ];
    const participantUsers = new Map<number, any>(
      (await prisma.user.findMany({
        where: { id: { in: participantUserIds } },
        select: { id: true, fullName: true, name: true, email: true },
      })).map((user) => [user.id, user] as [number, any])
    );

    const allItems = bookings.map((booking) => {
      const md = safeObject(booking.metadata);
      const invites = safeArray(md.timelineInvites);
      const activeInvite = invites.find((invite) => String(invite?.status || "ACTIVE").toUpperCase() === "ACTIVE");
      const joinedParticipants = joinedParticipantsFromMetadata(booking.metadata);
      const participantByUser = new Map<number, JoinedParticipantEntry>(
        joinedParticipants.map((participant) => [participant.userId, participant])
      );
      for (const contributorId of ratingContributorUserIds(md.timelineEventRatings)) {
        if (contributorId === Number(booking.customerId || 0)) continue;
        if (!participantByUser.has(contributorId)) {
          participantByUser.set(contributorId, { userId: contributorId, acceptedAt: null });
        }
      }
      const participants = [...participantByUser.values()];
      const rating = summarizeRatings(booking, participantUsers);
      const meetupValidated = isPickupValidated(booking.metadata);
      const lifecycleStatus = !meetupValidated ? "WAITING_MEETUP" : rating.completedTravellers > 0 ? "RATED" : "ACTIVE_TIMELINE";
      return {
        id: booking.id,
        bookingCode: booking.bookingCode,
        title: booking.title,
        destination: booking.destination,
        packageId: booking.packageId,
        operatorAgentId: booking.operatorAgentId,
        operatorName: operatorName(booking),
        customerName: displayName(booking.customer, "Booking owner"),
        travelerCount: booking.travelerCount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        startDate: booking.startDate,
        endDate: booking.endDate,
        meetup: {
          validated: meetupValidated,
          validatedAt: pickupValidatedAt(booking.metadata),
        },
        sharing: {
          generated: Boolean(activeInvite),
          generatedAt: activeInvite?.createdAt || null,
          joined: participants.length,
          capacity: Math.max(0, Number(booking.travelerCount || 1) - 1),
          participants: participants.map((participant) => {
            const userId = Number(participant.userId || 0);
            return {
              userId,
              name: displayName(participantUsers.get(userId), `Traveller #${userId}`),
              acceptedAt: participant.acceptedAt || null,
            };
          }),
        },
        rating,
        lifecycleStatus,
        updatedAt: booking.updatedAt,
        createdAt: booking.createdAt,
      };
    });

    // Every timeline with any experience signal. The summary, stage counts and moment
    // map are built from this full set, so switching the list tab never changes them.
    const withSignal = allItems.filter((item) =>
      item.meetup.validated || item.sharing.generated || item.sharing.joined > 0 || item.rating.totalRatings > 0
    );
    const items = withSignal.filter((item) => {
      if (status !== "ALL" && item.lifecycleStatus !== status) return false;
      if (!q) return true;
      return [item.bookingCode, item.title, item.destination, item.operatorName, item.customerName].filter(Boolean).join(" ").toLowerCase().includes(q);
    });

    const totalRatingsAll = withSignal.reduce((sum, item) => sum + item.rating.totalRatings, 0);
    const summary = {
      total: withSignal.length,
      meetupValidated: withSignal.filter((item) => item.meetup.validated).length,
      inviteGenerated: withSignal.filter((item) => item.sharing.generated).length,
      joinedTravellers: withSignal.reduce((sum, item) => sum + item.sharing.joined, 0),
      totalRatings: totalRatingsAll,
      averageRating: totalRatingsAll
        ? Number((withSignal.reduce((sum, item) => sum + item.rating.averageRating * item.rating.totalRatings, 0) / totalRatingsAll).toFixed(2))
        : 0,
      completedTravellers: withSignal.reduce((sum, item) => sum + item.rating.completedTravellers, 0),
      ratedTimelines: withSignal.filter((item) => item.rating.totalRatings > 0).length,
      stageCounts: {
        WAITING_MEETUP: withSignal.filter((item) => item.lifecycleStatus === "WAITING_MEETUP").length,
        ACTIVE_TIMELINE: withSignal.filter((item) => item.lifecycleStatus === "ACTIVE_TIMELINE").length,
        RATED: withSignal.filter((item) => item.lifecycleStatus === "RATED").length,
      },
    };

    // Moment map: per package, each itinerary moment's score pooled across all its trips.
    // A weak moment that repeats on every trip is a pattern to raise with the operator,
    // not a one-off; ratingCount and trips say how much evidence sits behind each score.
    type MomentAcc = { key: string; axisLabel: string; day: number; slotIndex: number; title: string; sum: number; ratingCount: number; trips: Set<string> };
    const byPackage = new Map<string, { key: string; title: string; operatorName: string; trips: Set<string>; moments: Map<string, MomentAcc> }>();
    for (const item of withSignal) {
      const pkgKey = `${item.operatorAgentId}::${item.packageId || String(item.title || "").trim().toLowerCase()}`;
      const pkg = byPackage.get(pkgKey) || { key: pkgKey, title: item.title || "Tour", operatorName: item.operatorName, trips: new Set<string>(), moments: new Map() };
      pkg.trips.add(item.bookingCode);
      for (const point of item.rating.eventPoints as any[]) {
        const mKey = `${point.day}-${point.slotIndex}::${String(point.title || "").trim().toLowerCase()}`;
        const m = pkg.moments.get(mKey) || { key: mKey, axisLabel: point.axisLabel, day: Number(point.day || 0), slotIndex: Number(point.slotIndex || 0), title: point.title, sum: 0, ratingCount: 0, trips: new Set<string>() };
        if (point.ratingCount > 0) {
          m.sum += Number(point.average) * Number(point.ratingCount);
          m.ratingCount += Number(point.ratingCount);
          m.trips.add(item.bookingCode);
        }
        pkg.moments.set(mKey, m);
      }
      byPackage.set(pkgKey, pkg);
    }
    const momentMap = [...byPackage.values()].map((pkg) => {
      const moments = [...pkg.moments.values()]
        .sort((a, b) => a.day - b.day || a.slotIndex - b.slotIndex)
        .map((m) => ({
          key: m.key,
          axisLabel: m.axisLabel,
          day: m.day,
          title: m.title,
          average: m.ratingCount ? Number((m.sum / m.ratingCount).toFixed(2)) : 0,
          ratingCount: m.ratingCount,
          trips: m.trips.size,
        }));
      const rated = moments.filter((m) => m.ratingCount > 0);
      const ratingCount = rated.reduce((n, m) => n + m.ratingCount, 0);
      return {
        key: pkg.key,
        title: pkg.title,
        operatorName: pkg.operatorName,
        trips: pkg.trips.size,
        ratingCount,
        average: ratingCount ? Number((rated.reduce((n, m) => n + m.average * m.ratingCount, 0) / ratingCount).toFixed(2)) : 0,
        moments,
      };
    }).sort((a, b) => b.ratingCount - a.ratingCount || a.title.localeCompare(b.title));

    return res.json({ ok: true, summary, items, momentMap });
  } catch (err: any) {
    console.error("[GET /api/admin/tour-experience/overview] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load tour experience overview" });
  }
}) as RequestHandler);

export default router;
