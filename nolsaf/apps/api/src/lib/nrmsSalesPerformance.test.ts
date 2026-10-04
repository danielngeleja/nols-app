// What the sales production report counts, and how it counts it.
//
// The arithmetic here is the whole product: a report that quietly credits the
// wrong person, or averages an average, is worse than no report because it will
// be believed. Each case below is one way of getting that wrong.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  inquiryFindMany: vi.fn(),
  messageGroupBy: vi.fn(),
  blockFindMany: vi.fn(),
  linkFindMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => {
  const prisma = {
    user: { findMany: mocks.userFindMany },
    nrmsGuestInquiry: { findMany: mocks.inquiryFindMany },
    nrmsGuestMessage: { groupBy: mocks.messageGroupBy },
    nrmsGroupBlock: { findMany: mocks.blockFindMany },
    nrmsAgentPropertyLink: { findMany: mocks.linkFindMany },
  };
  return { prisma, typedPrisma: prisma };
});

import { buildNrmsSalesPerformance } from "./nrmsSalesPerformance.js";

const PROPERTY_ID = 91;
const ASHA = 41;
const BAKARI = 42;
const IDLE = 43;

const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-31T00:00:00.000Z");

/** An inquiry created at a known time, answered `minutes` later or never. */
function inquiry(assignedToId: number, options: {
  minutes?: number | null;
  status?: string;
  reservationStatus?: string | null;
  hasReservation?: boolean;
} = {}) {
  const createdAt = new Date("2026-08-10T08:00:00.000Z");
  const { minutes = null, status = "OPEN", reservationStatus = null, hasReservation = reservationStatus != null } = options;
  return {
    assignedToId,
    status,
    createdAt,
    firstResponseAt: minutes == null ? null : new Date(createdAt.getTime() + minutes * 60_000),
    reservationId: hasReservation ? 900 : null,
    reservation: reservationStatus ? { status: reservationStatus } : null,
  };
}

function run(staffIds: number[] = [ASHA, BAKARI, IDLE]) {
  return buildNrmsSalesPerformance({
    propertyId: PROPERTY_ID,
    scope: "PROPERTY",
    from: FROM,
    to: TO,
    staffIds,
    fallbackCurrency: "TZS",
  });
}

describe("buildNrmsSalesPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindMany.mockResolvedValue([
      { id: ASHA, name: null, fullName: "Asha Mwinyi", email: "asha@hotel.co.tz" },
      { id: BAKARI, name: "Bakari", fullName: null, email: "bakari@hotel.co.tz" },
      { id: IDLE, name: null, fullName: null, email: "newstarter@hotel.co.tz" },
    ]);
    mocks.inquiryFindMany.mockResolvedValue([]);
    mocks.messageGroupBy.mockResolvedValue([]);
    mocks.blockFindMany.mockResolvedValue([]);
    mocks.linkFindMany.mockResolvedValue([]);
  });

  it("credits inquiries to the person they are assigned to", async () => {
    mocks.inquiryFindMany.mockResolvedValue([
      inquiry(ASHA, { minutes: 30 }),
      inquiry(ASHA, { minutes: 30 }),
      inquiry(BAKARI, { minutes: 10 }),
    ]);
    const report = await run();
    const asha = report.people.find((person) => person.userId === ASHA)!;
    const bakari = report.people.find((person) => person.userId === BAKARI)!;
    expect(asha.inbox.assigned).toBe(2);
    expect(bakari.inbox.assigned).toBe(1);
  });

  it("averages first reply over answered inquiries, not over people", async () => {
    // Asha answered two at 30 minutes, Bakari one at 10. The mean of their two
    // averages is 20, which is the wrong answer: the property answered three
    // inquiries in 70 minutes of waiting, so 23.3 is the true figure. This is
    // the number a manager would act on.
    mocks.inquiryFindMany.mockResolvedValue([
      inquiry(ASHA, { minutes: 30 }),
      inquiry(ASHA, { minutes: 30 }),
      inquiry(BAKARI, { minutes: 10 }),
    ]);
    const report = await run();
    expect(report.people.find((person) => person.userId === ASHA)!.inbox.averageFirstResponseMinutes).toBe(30);
    expect(report.people.find((person) => person.userId === BAKARI)!.inbox.averageFirstResponseMinutes).toBe(10);
    expect(report.totals.averageFirstResponseMinutes).toBe(23.3);
  });

  it("never divides the average by inquiries that were never answered", async () => {
    // One answered in 20 minutes, three still silent. The average first reply
    // is 20, not 5: an unanswered inquiry has no response time to average.
    mocks.inquiryFindMany.mockResolvedValue([
      inquiry(ASHA, { minutes: 20 }),
      inquiry(ASHA, { minutes: null, status: "NEW" }),
      inquiry(ASHA, { minutes: null, status: "OPEN" }),
      inquiry(ASHA, { minutes: null, status: "OPEN" }),
    ]);
    const report = await run();
    const asha = report.people.find((person) => person.userId === ASHA)!;
    expect(asha.inbox.answered).toBe(1);
    expect(asha.inbox.awaitingFirstReply).toBe(3);
    expect(asha.inbox.averageFirstResponseMinutes).toBe(20);
  });

  it("separates reaching a hold from the hold being confirmed", async () => {
    mocks.inquiryFindMany.mockResolvedValue([
      inquiry(ASHA, { minutes: 5, reservationStatus: "CONFIRMED" }),
      inquiry(ASHA, { minutes: 5, reservationStatus: "HELD" }),
      inquiry(ASHA, { minutes: 5, reservationStatus: "CANCELLED" }),
      inquiry(ASHA, { minutes: 5, status: "CLOSED" }),
    ]);
    const report = await run();
    const asha = report.people.find((person) => person.userId === ASHA)!;
    expect(asha.conversion.reachedHold).toBe(3);
    expect(asha.conversion.confirmed).toBe(1);
    expect(asha.conversion.lost).toBe(1);
  });

  it("values a block at the rates that were agreed, across its nights", async () => {
    mocks.blockFindMany.mockResolvedValue([
      {
        createdById: ASHA,
        status: "HELD",
        currency: "TZS",
        checkIn: new Date("2026-09-01T00:00:00.000Z"),
        checkOut: new Date("2026-09-05T00:00:00.000Z"),
        createdAt: new Date("2026-08-12T09:00:00.000Z"),
        rooms: [
          { quantity: 3, pickedUp: 0, nightlyRate: 100_000 },
          { quantity: 2, pickedUp: 1, nightlyRate: 150_000 },
        ],
      },
    ]);
    const report = await run();
    const asha = report.people.find((person) => person.userId === ASHA)!;
    expect(asha.groups.agreed).toBe(1);
    expect(asha.groups.roomsAgreed).toBe(5);
    expect(asha.groups.roomsPickedUp).toBe(1);
    // (3 x 100,000 + 2 x 150,000) x 4 nights
    expect(asha.groups.value).toBe(2_400_000);
    expect(asha.groups.live).toBe(1);
  });

  it("splits block outcomes so a released block is not read as production", async () => {
    const base = {
      createdById: BAKARI,
      currency: "TZS",
      checkIn: new Date("2026-09-01T00:00:00.000Z"),
      checkOut: new Date("2026-09-02T00:00:00.000Z"),
      createdAt: new Date("2026-08-12T09:00:00.000Z"),
      rooms: [{ quantity: 5, pickedUp: 0, nightlyRate: 0 }],
    };
    mocks.blockFindMany.mockResolvedValue([
      { ...base, status: "PICKED_UP" },
      { ...base, status: "RELEASED" },
      { ...base, status: "CANCELLED" },
      { ...base, status: "PARTIALLY_PICKED_UP" },
    ]);
    const report = await run();
    const bakari = report.people.find((person) => person.userId === BAKARI)!;
    expect(bakari.groups.agreed).toBe(4);
    expect(bakari.groups.pickedUp).toBe(1);
    expect(bakari.groups.released).toBe(1);
    expect(bakari.groups.cancelled).toBe(1);
    expect(bakari.groups.live).toBe(1);
  });

  it("reports a person with nothing rather than dropping them", async () => {
    // "Did no business" and "was never on the roster" must not look the same.
    const report = await run();
    const idle = report.people.find((person) => person.userId === IDLE);
    expect(idle).toBeDefined();
    expect(idle!.inbox.assigned).toBe(0);
    expect(idle!.groups.agreed).toBe(0);
    expect(idle!.inbox.averageFirstResponseMinutes).toBeNull();
    expect(idle!.name).toBe("newstarter@hotel.co.tz");
  });

  it("counts a person once even if their id is passed twice", async () => {
    // The owner can also hold a membership row on their own property.
    mocks.inquiryFindMany.mockResolvedValue([inquiry(ASHA, { minutes: 12 })]);
    const report = await run([ASHA, ASHA]);
    expect(report.people).toHaveLength(1);
    expect(report.totals.assigned).toBe(1);
  });

  it("counts replies by who sent them, not by who owns the inquiry", async () => {
    mocks.messageGroupBy.mockResolvedValue([
      { sentById: BAKARI, _count: { _all: 17 } },
    ]);
    mocks.inquiryFindMany.mockResolvedValue([inquiry(ASHA, { minutes: 5 })]);
    const report = await run();
    expect(report.people.find((person) => person.userId === ASHA)!.inbox.repliesSent).toBe(0);
    expect(report.people.find((person) => person.userId === BAKARI)!.inbox.repliesSent).toBe(17);
  });

  it("returns an empty report rather than querying for nobody", async () => {
    const report = await run([]);
    expect(report.people).toEqual([]);
    expect(report.totals.assigned).toBe(0);
    expect(mocks.inquiryFindMany).not.toHaveBeenCalled();
  });
});
