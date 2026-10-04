// apps/api/src/lib/nrmsCommercialReport.ts
//
// The commercial half of the property report.
//
// The reporting centre was built around operations, finance and audit:
// reservations, rooms, folios, payments, outlets, housekeeping, expenses, P&L.
// It was complete about how the hotel ran and silent about how it sold.
//
// Group business appeared only as money, through the master folio, so a pack
// could show an agency owing millions without showing that six blocks had been
// agreed, how many rooms were held, or how many were released unsold. Inquiries,
// agency relationships, per person production and who holds which role appeared
// nowhere at all.
//
// This builds that missing half. It deliberately reuses the two builders that
// already exist rather than recomputing their arithmetic a second way:
// buildInquiryConversionReport for the funnel, buildNrmsSalesPerformance for
// per person production. A report that disagreed with the screen it was printed
// from would be worse than no report.
//
// Basis note, in the same spirit as the report's own `control.basis` block:
// group and agency production are counted by AGREEMENT DATE, meaning the day
// the block or the relationship was created, not the day the guests arrive.
// That is the sales question. The stay-date view of the same business is
// already carried by the occupancy and master folio sections.

import { typedPrisma as prisma } from "@nolsaf/prisma";
import { buildInquiryConversionReport } from "./nrmsInquiryReporting.js";
import { buildNrmsSalesPerformance, type SalesPerformance } from "./nrmsSalesPerformance.js";
import { nrmsStaffRoleLabel } from "./nrmsStaffRoles.js";

const LIVE_BLOCK_STATUSES = ["HELD", "PARTIALLY_PICKED_UP"];
/** Roles whose production this report attributes. See owner.nrms.salesPerformance. */
const SALES_ROSTER_ROLES = ["MANAGER", "SALES_EXECUTIVE"];
const MAX_ROWS = 1_000;

export type NrmsCommercialReport = {
  basis: { groupProduction: string; agencyProduction: string; inquiries: string };
  groups: {
    currency: string;
    agreed: number;
    roomsAgreed: number;
    roomsPickedUp: number;
    roomsStillHeld: number;
    value: number;
    outcome: { live: number; pickedUp: number; released: number; cancelled: number };
    /** Rooms named as a share of rooms agreed. The number the desk is judged on. */
    pickupRatePct: number | null;
    /** Live blocks whose decision date has passed with rooms still unnamed. */
    lapsedCutOffs: number;
    rows: Array<{
      reference: string; name: string; agencyName: string | null; agreedBy: string;
      agreedOn: string; checkIn: string; checkOut: string; cutOffAt: string; cutOffPassed: boolean;
      status: string; nights: number; roomsAgreed: number; roomsPickedUp: number; roomsStillHeld: number;
      value: number; currency: string;
    }>;
  };
  inquiries: ReturnType<typeof buildInquiryConversionReport>;
  agents: {
    introducedInPeriod: number;
    byStatus: Array<{ status: string; count: number }>;
    bookingRequests: Array<{ status: string; count: number; rooms: number }>;
    rows: Array<{ agency: string; status: string; startedOn: string | null; bookingRequests: number }>;
  };
  production: SalesPerformance;
  staffAccess: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byRole: Array<{ role: string; roleLabel: string; active: number; pending: number; other: number }>;
    rows: Array<{ name: string; role: string; roleLabel: string; status: string; outlet: string | null; confirmedOn: string | null; joinedOn: string }>;
  };
};

function decimal(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function nightsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function isoDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function personName(user: { fullName?: string | null; name?: string | null; email?: string | null } | null | undefined): string {
  return user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Not recorded";
}

function tally<T>(rows: T[], key: (row: T) => string): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

export async function buildNrmsCommercialReport(input: {
  propertyId: number;
  ownerId: number;
  rangeStart: Date;
  rangeEnd: Date;
  rangeDays: number;
  fallbackCurrency: string;
}): Promise<NrmsCommercialReport> {
  const { propertyId, ownerId, rangeStart, rangeEnd, rangeDays, fallbackCurrency } = input;
  const window = { gte: rangeStart, lt: rangeEnd };
  // The funnel builder measures response speed against creation time, so it
  // needs the metric rows from the same period, truncated to whole days the way
  // NrmsPublicMetric stores them.
  const metricSince = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate()));

  const [groupBlocks, inquiryRows, directMetrics, agentLinks, bookingRequests, memberships] = await Promise.all([
    prisma.nrmsGroupBlock.findMany({
      where: { propertyId, createdAt: window },
      select: {
        reference: true, name: true, agencyName: true, status: true, currency: true,
        checkIn: true, checkOut: true, cutOffAt: true, createdAt: true,
        createdBy: { select: { fullName: true, name: true, email: true } },
        rooms: { select: { quantity: true, pickedUp: true, nightlyRate: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.nrmsGuestInquiry.findMany({
      where: { propertyId, createdAt: window },
      select: { source: true, createdAt: true, firstResponseAt: true, reservationId: true, reservation: { select: { status: true } } },
    }),
    prisma.nrmsPublicMetric.findMany({
      where: { propertyId, metricDate: { gte: metricSince, lt: rangeEnd }, kind: { startsWith: "DIRECT:PAGE_OPEN:" } },
      select: { kind: true, count: true },
    }),
    // Every relationship, not only the ones started in the period: "who sells
    // this property" is a standing position, and a report that showed only the
    // month's new agencies would read as though the rest had gone away.
    prisma.nrmsAgentPropertyLink.findMany({
      where: { propertyId },
      select: {
        status: true, requestedAt: true,
        agentAccount: { select: { legalName: true, tradingName: true } },
        _count: { select: { bookingRequests: true } },
      },
      orderBy: { id: "desc" },
      take: MAX_ROWS,
    }),
    prisma.nrmsAgentBookingRequest.findMany({
      where: { propertyId, createdAt: window },
      select: { status: true, roomsRequested: true },
      take: MAX_ROWS,
    }),
    prisma.nrmsStaffMembership.findMany({
      where: { propertyId },
      select: {
        role: true, status: true, confirmedAt: true, createdAt: true, userId: true,
        user: { select: { fullName: true, name: true, email: true } },
        outlet: { select: { name: true } },
      },
      orderBy: { id: "asc" },
      take: MAX_ROWS,
    }),
  ]);

  // Group business.
  const blockRows = groupBlocks.map((block: any) => {
    const nights = nightsBetween(block.checkIn, block.checkOut);
    const rooms = block.rooms ?? [];
    const roomsAgreed = rooms.reduce((sum: number, room: any) => sum + room.quantity, 0);
    const roomsPickedUp = rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
    return {
      reference: block.reference,
      name: block.name,
      agencyName: block.agencyName ?? null,
      agreedBy: personName(block.createdBy),
      agreedOn: isoDay(block.createdAt),
      checkIn: isoDay(block.checkIn),
      checkOut: isoDay(block.checkOut),
      cutOffAt: isoDay(block.cutOffAt),
      cutOffPassed: block.cutOffAt.getTime() < Date.now(),
      status: block.status,
      nights,
      roomsAgreed,
      roomsPickedUp,
      roomsStillHeld: Math.max(0, roomsAgreed - roomsPickedUp),
      value: round(rooms.reduce((sum: number, room: any) => sum + decimal(room.nightlyRate) * room.quantity * nights, 0)),
      currency: block.currency || fallbackCurrency,
    };
  });

  const roomsAgreed = blockRows.reduce((sum, row) => sum + row.roomsAgreed, 0);
  const roomsPickedUp = blockRows.reduce((sum, row) => sum + row.roomsPickedUp, 0);
  const groups: NrmsCommercialReport["groups"] = {
    currency: blockRows[0]?.currency ?? fallbackCurrency,
    agreed: blockRows.length,
    roomsAgreed,
    roomsPickedUp,
    roomsStillHeld: blockRows
      .filter((row) => LIVE_BLOCK_STATUSES.includes(row.status))
      .reduce((sum, row) => sum + row.roomsStillHeld, 0),
    value: round(blockRows.reduce((sum, row) => sum + row.value, 0)),
    outcome: {
      live: blockRows.filter((row) => LIVE_BLOCK_STATUSES.includes(row.status)).length,
      pickedUp: blockRows.filter((row) => row.status === "PICKED_UP").length,
      released: blockRows.filter((row) => row.status === "RELEASED").length,
      cancelled: blockRows.filter((row) => row.status === "CANCELLED").length,
    },
    // Null rather than zero when nothing was agreed: "0% picked up" would be a
    // judgement on a month in which nobody promised anything.
    pickupRatePct: roomsAgreed > 0 ? Number(((roomsPickedUp / roomsAgreed) * 100).toFixed(1)) : null,
    lapsedCutOffs: blockRows.filter((row) => LIVE_BLOCK_STATUSES.includes(row.status) && row.cutOffPassed && row.roomsStillHeld > 0).length,
    rows: blockRows,
  };

  // Agencies.
  const agents: NrmsCommercialReport["agents"] = {
    introducedInPeriod: agentLinks.filter((link: any) => link.requestedAt && link.requestedAt >= rangeStart && link.requestedAt < rangeEnd).length,
    byStatus: tally(agentLinks as any[], (link) => String(link.status)),
    bookingRequests: tally(bookingRequests as any[], (item) => String(item.status)).map((row) => ({
      ...row,
      rooms: (bookingRequests as any[])
        .filter((item) => String(item.status) === row.status)
        .reduce((sum: number, item: any) => sum + (item.roomsRequested ?? 0), 0),
    })),
    rows: (agentLinks as any[]).map((link) => ({
      // Trading name is what a hotel calls them; legal name is the fallback.
      agency: link.agentAccount?.tradingName?.trim() || link.agentAccount?.legalName?.trim() || "Agency not named",
      status: String(link.status),
      startedOn: link.requestedAt ? isoDay(link.requestedAt) : null,
      bookingRequests: link._count?.bookingRequests ?? 0,
    })),
  };

  // Who holds access, and in what state. Every role, not only the sales roster:
  // this answers "who can get into this property's NRMS", which is an audit
  // question rather than a sales one.
  const staffRows = (memberships as any[]).map((membership) => ({
    name: personName(membership.user),
    role: String(membership.role),
    roleLabel: nrmsStaffRoleLabel(String(membership.role)),
    status: String(membership.status),
    outlet: membership.outlet?.name ?? null,
    confirmedOn: membership.confirmedAt ? isoDay(membership.confirmedAt) : null,
    joinedOn: isoDay(membership.createdAt),
  }));
  const roleKeys = [...new Set(staffRows.map((row) => row.role))].sort();
  const staffAccess: NrmsCommercialReport["staffAccess"] = {
    total: staffRows.length,
    byStatus: tally(staffRows, (row) => row.status),
    byRole: roleKeys.map((role) => {
      const forRole = staffRows.filter((row) => row.role === role);
      return {
        role,
        roleLabel: nrmsStaffRoleLabel(role),
        active: forRole.filter((row) => row.status === "ACTIVE").length,
        pending: forRole.filter((row) => row.status === "PENDING").length,
        other: forRole.filter((row) => !["ACTIVE", "PENDING"].includes(row.status)).length,
      };
    }),
    rows: staffRows,
  };

  // Per person production. The roster is the owner plus active managers and
  // sales executives, matching the sales performance screen exactly so the two
  // can never report different numbers for the same person.
  const rosterIds = [
    ownerId,
    ...(memberships as any[])
      .filter((membership) => membership.status === "ACTIVE" && SALES_ROSTER_ROLES.includes(String(membership.role)))
      .map((membership) => membership.userId as number),
  ];
  const production = await buildNrmsSalesPerformance({
    propertyId,
    scope: "PROPERTY",
    from: rangeStart,
    to: rangeEnd,
    staffIds: rosterIds,
    fallbackCurrency,
  });

  return {
    basis: {
      groupProduction: "AGREEMENT_DATE",
      agencyProduction: "RELATIONSHIP_START_DATE",
      inquiries: "INQUIRY_CREATED_DATE",
    },
    groups,
    inquiries: buildInquiryConversionReport(directMetrics as any, inquiryRows as any, rangeDays),
    agents,
    production,
    staffAccess,
  };
}
