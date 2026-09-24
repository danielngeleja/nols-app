// The commercial half of the property report.
//
// This section will be printed, signed and handed to an accountant or an
// owner in a dispute, so the cases below are the ones where a wrong number
// would be believed: a rate that never gets multiplied by nights, a released
// block counted as production, an agency list that quietly forgets everyone
// who joined before this month.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  blockFindMany: vi.fn(),
  inquiryFindMany: vi.fn(),
  metricFindMany: vi.fn(),
  linkFindMany: vi.fn(),
  bookingRequestFindMany: vi.fn(),
  membershipFindMany: vi.fn(),
  userFindMany: vi.fn(),
  messageGroupBy: vi.fn(),
  agentLinkForProduction: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => {
  const prisma = {
    nrmsGroupBlock: { findMany: mocks.blockFindMany },
    nrmsGuestInquiry: { findMany: mocks.inquiryFindMany },
    nrmsPublicMetric: { findMany: mocks.metricFindMany },
    nrmsAgentPropertyLink: { findMany: mocks.linkFindMany },
    nrmsAgentBookingRequest: { findMany: mocks.bookingRequestFindMany },
    nrmsStaffMembership: { findMany: mocks.membershipFindMany },
    user: { findMany: mocks.userFindMany },
    nrmsGuestMessage: { groupBy: mocks.messageGroupBy },
  };
  return { prisma, typedPrisma: prisma };
});

import { buildNrmsCommercialReport } from "./nrmsCommercialReport.js";

const PROPERTY_ID = 91;
const OWNER_ID = 12;
const RANGE_START = new Date("2026-08-01T00:00:00.000Z");
const RANGE_END = new Date("2026-09-01T00:00:00.000Z");

function block(overrides: Record<string, unknown> = {}) {
  return {
    reference: "BLK-1",
    name: "Kilimanjaro Expedition",
    agencyName: "Summit Travel",
    status: "HELD",
    currency: "TZS",
    checkIn: new Date("2026-09-01T00:00:00.000Z"),
    checkOut: new Date("2026-09-05T00:00:00.000Z"),
    cutOffAt: new Date("2026-08-20T00:00:00.000Z"),
    createdAt: new Date("2026-08-05T09:00:00.000Z"),
    createdBy: { fullName: "Asha Mwinyi", name: null, email: null },
    rooms: [{ quantity: 3, pickedUp: 0, nightlyRate: 100_000 }],
    ...overrides,
  };
}

function run() {
  return buildNrmsCommercialReport({
    propertyId: PROPERTY_ID,
    ownerId: OWNER_ID,
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END,
    rangeDays: 31,
    fallbackCurrency: "TZS",
  });
}

describe("buildNrmsCommercialReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.blockFindMany.mockResolvedValue([]);
    mocks.inquiryFindMany.mockResolvedValue([]);
    mocks.metricFindMany.mockResolvedValue([]);
    mocks.linkFindMany.mockResolvedValue([]);
    mocks.bookingRequestFindMany.mockResolvedValue([]);
    mocks.membershipFindMany.mockResolvedValue([]);
    mocks.userFindMany.mockResolvedValue([]);
    mocks.messageGroupBy.mockResolvedValue([]);
  });

  it("values a block at its agreed rates across its nights", async () => {
    mocks.blockFindMany.mockResolvedValue([
      block({ rooms: [{ quantity: 3, pickedUp: 1, nightlyRate: 100_000 }, { quantity: 2, pickedUp: 0, nightlyRate: 150_000 }] }),
    ]);
    const report = await run();
    expect(report.groups.roomsAgreed).toBe(5);
    expect(report.groups.roomsPickedUp).toBe(1);
    // (3 x 100,000 + 2 x 150,000) x 4 nights. Forgetting the nights would
    // report 600,000 and understate the agreement fourfold.
    expect(report.groups.value).toBe(2_400_000);
  });

  it("separates a block that produced business from one that did not", async () => {
    mocks.blockFindMany.mockResolvedValue([
      block({ reference: "A", status: "PICKED_UP" }),
      block({ reference: "B", status: "RELEASED" }),
      block({ reference: "C", status: "CANCELLED" }),
      block({ reference: "D", status: "PARTIALLY_PICKED_UP" }),
    ]);
    const report = await run();
    expect(report.groups.agreed).toBe(4);
    expect(report.groups.outcome).toEqual({ live: 1, pickedUp: 1, released: 1, cancelled: 1 });
  });

  it("reports no pickup rate rather than nought percent when nothing was agreed", async () => {
    // "0% picked up" is a judgement on a month in which nobody promised
    // anything, and it would look like a failure that never happened.
    const report = await run();
    expect(report.groups.pickupRatePct).toBeNull();
  });

  it("counts a lapsed cut-off only while rooms are still held", async () => {
    mocks.blockFindMany.mockResolvedValue([
      // Past cut-off, rooms unnamed: the desk should have released these.
      block({ reference: "A", status: "HELD", cutOffAt: new Date("2026-08-02T00:00:00.000Z"), rooms: [{ quantity: 4, pickedUp: 0, nightlyRate: 1 }] }),
      // Past cut-off but every room named, so nothing is being wasted.
      block({ reference: "B", status: "HELD", cutOffAt: new Date("2026-08-02T00:00:00.000Z"), rooms: [{ quantity: 4, pickedUp: 4, nightlyRate: 1 }] }),
      // Already closed out.
      block({ reference: "C", status: "RELEASED", cutOffAt: new Date("2026-08-02T00:00:00.000Z"), rooms: [{ quantity: 4, pickedUp: 0, nightlyRate: 1 }] }),
    ]);
    const report = await run();
    expect(report.groups.lapsedCutOffs).toBe(1);
  });

  it("lists every agency relationship, not only this month's", async () => {
    // A pack showing only new agencies would read as though the rest had gone.
    mocks.linkFindMany.mockResolvedValue([
      { status: "ACTIVE", requestedAt: new Date("2025-02-01T00:00:00.000Z"), agentAccount: { tradingName: "Summit Travel", legalName: "Summit Ltd" }, _count: { bookingRequests: 9 } },
      { status: "REQUESTED", requestedAt: new Date("2026-08-14T00:00:00.000Z"), agentAccount: { tradingName: null, legalName: "Kibo Tours Limited" }, _count: { bookingRequests: 0 } },
    ]);
    const report = await run();
    expect(report.agents.rows).toHaveLength(2);
    expect(report.agents.introducedInPeriod).toBe(1);
    expect(report.agents.rows[0].agency).toBe("Summit Travel");
    // Falls back to the legal name when a hotel-facing trading name is unset.
    expect(report.agents.rows[1].agency).toBe("Kibo Tours Limited");
  });

  it("lists staff of every status, because access history is the question", async () => {
    mocks.membershipFindMany.mockResolvedValue([
      { role: "SALES_EXECUTIVE", status: "ACTIVE", confirmedAt: new Date("2026-07-02T00:00:00.000Z"), createdAt: new Date("2026-07-01T00:00:00.000Z"), userId: 41, user: { fullName: "Asha Mwinyi" }, outlet: null },
      { role: "BAR", status: "REVOKED", confirmedAt: null, createdAt: new Date("2026-06-01T00:00:00.000Z"), userId: 55, user: { fullName: "Juma Said" }, outlet: { name: "Pool Bar" } },
    ]);
    const report = await run();
    expect(report.staffAccess.total).toBe(2);
    expect(report.staffAccess.rows.map((row) => row.status)).toEqual(["ACTIVE", "REVOKED"]);
    expect(report.staffAccess.rows[1].outlet).toBe("Pool Bar");
    expect(report.staffAccess.rows[0].roleLabel).toBe("Sales executive");
  });

  it("builds the production roster from the owner plus active sales staff", async () => {
    mocks.membershipFindMany.mockResolvedValue([
      { role: "SALES_EXECUTIVE", status: "ACTIVE", confirmedAt: null, createdAt: RANGE_START, userId: 41, user: { fullName: "Asha" }, outlet: null },
      { role: "MANAGER", status: "ACTIVE", confirmedAt: null, createdAt: RANGE_START, userId: 42, user: { fullName: "Bakari" }, outlet: null },
      // Neither of these sells, so neither belongs on a sales roster.
      { role: "BAR", status: "ACTIVE", confirmedAt: null, createdAt: RANGE_START, userId: 43, user: { fullName: "Juma" }, outlet: null },
      { role: "SALES_EXECUTIVE", status: "REVOKED", confirmedAt: null, createdAt: RANGE_START, userId: 44, user: { fullName: "Old" }, outlet: null },
    ]);
    const report = await run();
    expect(report.production.people.map((person) => person.userId).sort()).toEqual([OWNER_ID, 41, 42]);
  });

  it("declares the basis it counted on", async () => {
    // The section will not tie to occupancy, and a reader who spots that must
    // be told why rather than left to assume one of the two is wrong.
    const report = await run();
    expect(report.basis.groupProduction).toBe("AGREEMENT_DATE");
  });
});
