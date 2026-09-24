// apps/api/src/lib/nrmsSalesPerformance.ts
//
// What a sales person actually produced.
//
// NRMS could report the property's occupancy, its revenue, its outlet tickets
// and its night audit, and could not answer "what did this sales executive do
// this month". Every piece of the answer was already being written down and
// nothing read it back:
//
//   NrmsGuestInquiry.assignedToId   who owns the conversation
//   NrmsGuestMessage.sentById       who actually replied
//   NrmsGroupBlock.createdById      who agreed the group
//   NrmsAgentPropertyLink.requestedByUserId  who brought the agency in
//
// This module joins those four together for one property over one period.
//
// Two things it deliberately is not:
//
//   Not a revenue report. The only money here is the value of the agreements a
//   person made at the rates they agreed, which is their own work. Property
//   revenue, folios and settlement stay behind finance.revenue.read.
//
//   Not an attendance record. A person with nothing in the period reports
//   zeroes rather than being dropped, because "did nothing" and "was not asked"
//   look identical once a row disappears.

import { typedPrisma as prisma } from "@nolsaf/prisma";

/** Reservation states that mean the business actually held. */
const CONFIRMED_RESERVATION_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

/** Block states that are still running and could still produce. */
const LIVE_BLOCK_STATUSES = ["HELD", "PARTIALLY_PICKED_UP"];

export type SalesPerformanceScope = "OWN" | "PROPERTY";

export type SalesPerformancePerson = {
  userId: number;
  name: string;
  role: string;
  inbox: {
    /** Inquiries that arrived in the period and carry this person's name. */
    assigned: number;
    /** Outbound messages this person sent, whoever the inquiry belongs to. */
    repliesSent: number;
    /** Assigned inquiries that got a first reply from anyone. */
    answered: number;
    /** Assigned, still open, still with no first reply. */
    awaitingFirstReply: number;
    averageFirstResponseMinutes: number | null;
  };
  conversion: {
    /**
     * Assigned inquiries that reached a held reservation. Credited to the
     * person who worked the conversation, not to whoever pressed the button:
     * a sales executive holds no reservation.create today, so crediting the
     * click would credit their own work to the front desk.
     */
    reachedHold: number;
    /** Of those, the ones that became a real stay. */
    confirmed: number;
    /** Assigned inquiries that closed without ever reaching a hold. */
    lost: number;
  };
  groups: {
    agreed: number;
    roomsAgreed: number;
    /** Value of the agreements at the rates this person agreed. */
    value: number;
    currency: string;
    live: number;
    pickedUp: number;
    released: number;
    cancelled: number;
    roomsPickedUp: number;
  };
  agencies: {
    /** Agency relationships this person started in the period. */
    introduced: number;
    /** Of those, the ones selling the property now. */
    active: number;
  };
};

export type SalesPerformance = {
  propertyId: number;
  scope: SalesPerformanceScope;
  range: { from: string; to: string; days: number };
  currency: string;
  /** Everyone the report covers, zeroes included. */
  people: SalesPerformancePerson[];
  /** The same numbers added up across `people`. */
  totals: SalesPerformancePerson["inbox"] & {
    reachedHold: number;
    confirmed: number;
    groupsAgreed: number;
    roomsAgreed: number;
    groupValue: number;
    agenciesIntroduced: number;
  };
  /** Day by day, for a trend rather than one number. */
  timeline: Array<{ date: string; inquiries: number; replies: number; blocks: number }>;
};

function nightsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function personName(user: { name: string | null; fullName: string | null; email: string | null } | null, fallbackId: number): string {
  const named = user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim();
  return named || `User ${fallbackId}`;
}

/**
 * @param staffIds Who the report covers. One id for a sales executive looking
 *   at their own work, the whole sales roster for an owner or manager. The
 *   caller decides this, because the caller is the one that knows the role.
 */
export async function buildNrmsSalesPerformance(input: {
  propertyId: number;
  scope: SalesPerformanceScope;
  from: Date;
  to: Date;
  staffIds: number[];
  fallbackCurrency: string;
}): Promise<SalesPerformance> {
  const { propertyId, scope, from, to, fallbackCurrency } = input;
  // Deduplicated: the owner can also hold a membership row, and counting their
  // production twice would be worse than not reporting it at all.
  const staffIds = [...new Set(input.staffIds)];
  const range = { createdAt: { gte: from, lte: to } };

  if (staffIds.length === 0) {
    return {
      propertyId,
      scope,
      range: { from: from.toISOString(), to: to.toISOString(), days: Math.max(1, nightsBetween(from, to)) },
      currency: fallbackCurrency,
      people: [],
      totals: {
        assigned: 0, repliesSent: 0, answered: 0, awaitingFirstReply: 0, averageFirstResponseMinutes: null,
        reachedHold: 0, confirmed: 0, groupsAgreed: 0, roomsAgreed: 0, groupValue: 0, agenciesIntroduced: 0,
      },
      timeline: [],
    };
  }

  const [users, inquiries, replies, blocks, links] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true, fullName: true, email: true },
    }),
    // The whole inquiry, not a count: the answered, converted and waiting
    // figures are three different readings of the same rows, and one pass over
    // them is cheaper and more consistent than three aggregate queries.
    prisma.nrmsGuestInquiry.findMany({
      where: { propertyId, assignedToId: { in: staffIds }, ...range },
      select: {
        assignedToId: true,
        status: true,
        createdAt: true,
        firstResponseAt: true,
        reservationId: true,
        reservation: { select: { status: true } },
      },
    }),
    prisma.nrmsGuestMessage.groupBy({
      by: ["sentById"],
      where: { inquiry: { propertyId }, direction: "OUTBOUND", sentById: { in: staffIds }, ...range },
      _count: { _all: true },
    }),
    prisma.nrmsGroupBlock.findMany({
      where: { propertyId, createdById: { in: staffIds }, ...range },
      select: {
        createdById: true,
        status: true,
        currency: true,
        checkIn: true,
        checkOut: true,
        createdAt: true,
        rooms: { select: { quantity: true, pickedUp: true, nightlyRate: true } },
      },
    }),
    prisma.nrmsAgentPropertyLink.findMany({
      where: { propertyId, requestedByUserId: { in: staffIds }, requestedAt: { gte: from, lte: to } },
      select: { requestedByUserId: true, status: true },
    }),
  ]);

  const userById = new Map(users.map((user: any) => [user.id, user]));
  const replyCountById = new Map<number, number>(
    replies
      .filter((row: any) => row.sentById != null)
      .map((row: any) => [row.sentById as number, row._count._all as number]),
  );

  // Currency is the property's. A block carries its own, but a report that
  // silently mixed two currencies into one total would be worse than one that
  // states which currency it is quoting.
  const currency = blocks.find((block: any) => block.currency)?.currency ?? fallbackCurrency;

  const timeline = new Map<string, { date: string; inquiries: number; replies: number; blocks: number }>();
  const timelineRow = (date: Date) => {
    const key = dayKey(date);
    let row = timeline.get(key);
    if (!row) { row = { date: key, inquiries: 0, replies: 0, blocks: 0 }; timeline.set(key, row); }
    return row;
  };

  const people: SalesPerformancePerson[] = staffIds.map((userId) => ({
    userId,
    name: personName(userById.get(userId) ?? null, userId),
    // Filled in by the caller, which is the side that read the memberships.
    role: "",
    inbox: { assigned: 0, repliesSent: replyCountById.get(userId) ?? 0, answered: 0, awaitingFirstReply: 0, averageFirstResponseMinutes: null },
    conversion: { reachedHold: 0, confirmed: 0, lost: 0 },
    groups: { agreed: 0, roomsAgreed: 0, value: 0, currency, live: 0, pickedUp: 0, released: 0, cancelled: 0, roomsPickedUp: 0 },
    agencies: { introduced: 0, active: 0 },
  }));
  const personById = new Map(people.map((person) => [person.userId, person]));

  // Response minutes are summed separately so the average divides by the rows
  // that actually have a first reply, never by the whole assigned count.
  const responseMinutes = new Map<number, { total: number; count: number }>();

  for (const inquiry of inquiries as any[]) {
    const person = personById.get(inquiry.assignedToId);
    if (!person) continue;
    person.inbox.assigned += 1;
    timelineRow(inquiry.createdAt).inquiries += 1;

    if (inquiry.firstResponseAt) {
      person.inbox.answered += 1;
      const bucket = responseMinutes.get(person.userId) ?? { total: 0, count: 0 };
      bucket.total += Math.max(0, inquiry.firstResponseAt.getTime() - inquiry.createdAt.getTime()) / 60_000;
      bucket.count += 1;
      responseMinutes.set(person.userId, bucket);
    } else if (["NEW", "OPEN"].includes(inquiry.status)) {
      person.inbox.awaitingFirstReply += 1;
    }

    if (inquiry.reservationId) {
      person.conversion.reachedHold += 1;
      if (inquiry.reservation && CONFIRMED_RESERVATION_STATUSES.includes(inquiry.reservation.status)) {
        person.conversion.confirmed += 1;
      }
    } else if (["RESOLVED", "CLOSED"].includes(inquiry.status)) {
      person.conversion.lost += 1;
    }
  }

  for (const [userId, bucket] of responseMinutes) {
    const person = personById.get(userId);
    if (person && bucket.count > 0) {
      person.inbox.averageFirstResponseMinutes = Math.round((bucket.total / bucket.count) * 10) / 10;
    }
  }

  for (const block of blocks as any[]) {
    const person = personById.get(block.createdById);
    if (!person) continue;
    const nights = nightsBetween(block.checkIn, block.checkOut);
    const rooms = block.rooms ?? [];
    person.groups.agreed += 1;
    person.groups.roomsAgreed += rooms.reduce((sum: number, room: any) => sum + room.quantity, 0);
    person.groups.roomsPickedUp += rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
    person.groups.value += rooms.reduce((sum: number, room: any) => sum + Number(room.nightlyRate) * room.quantity * nights, 0);
    if (LIVE_BLOCK_STATUSES.includes(block.status)) person.groups.live += 1;
    else if (block.status === "PICKED_UP") person.groups.pickedUp += 1;
    else if (block.status === "RELEASED") person.groups.released += 1;
    else if (block.status === "CANCELLED") person.groups.cancelled += 1;
    timelineRow(block.createdAt).blocks += 1;
  }

  for (const link of links as any[]) {
    const person = personById.get(link.requestedByUserId);
    if (!person) continue;
    person.agencies.introduced += 1;
    if (link.status === "ACTIVE") person.agencies.active += 1;
  }

  for (const person of people) person.groups.value = Number(person.groups.value.toFixed(2));

  // Replies are counted per person, not per day, because groupBy gives the
  // total without the dates. The timeline shows what it can honestly show.
  const totals = people.reduce(
    (sum, person) => ({
      assigned: sum.assigned + person.inbox.assigned,
      repliesSent: sum.repliesSent + person.inbox.repliesSent,
      answered: sum.answered + person.inbox.answered,
      awaitingFirstReply: sum.awaitingFirstReply + person.inbox.awaitingFirstReply,
      averageFirstResponseMinutes: null as number | null,
      reachedHold: sum.reachedHold + person.conversion.reachedHold,
      confirmed: sum.confirmed + person.conversion.confirmed,
      groupsAgreed: sum.groupsAgreed + person.groups.agreed,
      roomsAgreed: sum.roomsAgreed + person.groups.roomsAgreed,
      groupValue: sum.groupValue + person.groups.value,
      agenciesIntroduced: sum.agenciesIntroduced + person.agencies.introduced,
    }),
    {
      assigned: 0, repliesSent: 0, answered: 0, awaitingFirstReply: 0, averageFirstResponseMinutes: null as number | null,
      reachedHold: 0, confirmed: 0, groupsAgreed: 0, roomsAgreed: 0, groupValue: 0, agenciesIntroduced: 0,
    },
  );
  // The group average is over answered inquiries, not the mean of each person's
  // average: one person answering forty inquiries should not weigh the same as
  // one answering a single fast one.
  const allResponses = [...responseMinutes.values()].reduce(
    (sum, bucket) => ({ total: sum.total + bucket.total, count: sum.count + bucket.count }),
    { total: 0, count: 0 },
  );
  totals.averageFirstResponseMinutes = allResponses.count > 0
    ? Math.round((allResponses.total / allResponses.count) * 10) / 10
    : null;
  totals.groupValue = Number(totals.groupValue.toFixed(2));

  return {
    propertyId,
    scope,
    range: { from: from.toISOString(), to: to.toISOString(), days: Math.max(1, nightsBetween(from, to)) },
    currency,
    people: people.sort((a, b) =>
      (b.conversion.confirmed - a.conversion.confirmed)
      || (b.groups.value - a.groups.value)
      || (b.inbox.assigned - a.inbox.assigned)
      || a.name.localeCompare(b.name)),
    totals,
    timeline: [...timeline.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
