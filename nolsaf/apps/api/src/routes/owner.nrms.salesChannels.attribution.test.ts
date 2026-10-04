import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A marketplace stay's Reservation is a projection: its createdAt is whenever
 * the sync happened to run, which for a self-healed booking is the day someone
 * opened the calendar. Windowing the BOOKED basis on that column reported
 * database maintenance as selling activity, and hid real sales in whatever
 * period the projection landed in. The sale date is the Booking's.
 */
const mocks = vi.hoisted(() => {
  const reservationFindMany = vi.fn();
  const prisma = {
    reservation: { findMany: reservationFindMany },
    property: { findUnique: vi.fn() },
    channelConnection: { findMany: vi.fn() },
    nrmsMessagingConnection: { findMany: vi.fn() },
    nrmsAgentPropertyLink: { findMany: vi.fn() },
    nrmsPublicMetric: { findMany: vi.fn() },
    nrmsGuestInquiry: { findMany: vi.fn() },
  };
  return { reservationFindMany, prisma, loadOwnedActiveNrmsProperty: vi.fn() };
});

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.user = { id: 41, role: "OWNER" }; next(); },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/nrms.js", () => ({
  loadOwnedActiveNrmsProperty: mocks.loadOwnedActiveNrmsProperty,
  requireNrms: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const PROPERTY_ID = 1;

/** Sold in early September, projected into NRMS only on the 17th. */
const marketplaceRow = {
  id: 68,
  source: "NOLSAF",
  status: "CONFIRMED",
  currency: "TZS",
  createdAt: new Date("2026-09-17T10:00:00+03:00"),
  checkIn: new Date("2026-09-22T00:00:00+03:00"),
  checkOut: new Date("2026-10-01T00:00:00+03:00"),
  cancelledAt: null,
  noShowAt: null,
  totalAmount: 0,
  chargesTotal: 0,
  amountPaid: 0,
  agentPropertyLinkId: null,
  bookingId: 68,
  allocations: [{ id: 5 }],
  masterFolioItems: [],
  agentPropertyLink: null,
  guestInquiry: null,
  booking: {
    createdAt: new Date("2026-09-03T09:00:00+03:00"),
    totalAmount: 495_000,
    invoices: [{ commissionAmount: 45_000, netPayable: 450_000, status: "PAID" }],
  },
};

async function buildApp() {
  const { router } = await import("./owner.nrms.salesChannels.js");
  const app = express();
  app.use(express.json());
  app.use("/api/owner/nrms/sales-channels", router);
  return app;
}

describe("sales channel attribution for marketplace stays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadOwnedActiveNrmsProperty.mockResolvedValue({ property: { id: PROPERTY_ID, title: "Test Lodge" } });
    mocks.prisma.property.findUnique.mockResolvedValue({ status: "APPROVED", currency: "TZS" });
    mocks.prisma.channelConnection.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsMessagingConnection.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsAgentPropertyLink.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsPublicMetric.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsGuestInquiry.findMany.mockResolvedValue([]);
    mocks.reservationFindMany.mockResolvedValue([]);
  });

  it("windows the BOOKED basis on the booking date for marketplace rows", async () => {
    const app = await buildApp();
    await request(app)
      .get(`/api/owner/nrms/sales-channels/property/${PROPERTY_ID}`)
      .query({ from: "2026-09-01", to: "2026-09-30", basis: "BOOKED" })
      .expect(200);

    const where = mocks.reservationFindMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    // Own reservations keep their own createdAt; marketplace rows defer to the
    // Booking that actually took the money.
    expect(where.OR[0]).toMatchObject({ bookingId: null });
    expect(where.OR[0].createdAt).toBeDefined();
    expect(where.OR[1].booking.is.createdAt).toBeDefined();
  });

  it("keeps the STAY basis on arrival dates", async () => {
    const app = await buildApp();
    await request(app)
      .get(`/api/owner/nrms/sales-channels/property/${PROPERTY_ID}`)
      .query({ from: "2026-09-01", to: "2026-09-30", basis: "STAY" })
      .expect(200);

    const where = mocks.reservationFindMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.checkIn).toBeDefined();
  });

  it("reports a stay in the period it was sold, not the period it was projected", async () => {
    mocks.reservationFindMany.mockImplementation(async (args: any) =>
      args.where.OR && args.where.OR[1]?.booking?.is?.createdAt?.gte?.getTime() === new Date("2026-09-01T00:00:00+03:00").getTime()
        ? [marketplaceRow]
        : [],
    );

    const app = await buildApp();
    const response = await request(app)
      .get(`/api/owner/nrms/sales-channels/property/${PROPERTY_ID}`)
      .query({ from: "2026-09-01", to: "2026-09-30", basis: "BOOKED" })
      .expect(200);

    const tzs = response.body.currencies.find((entry: any) => entry.currency === "TZS");
    const marketplace = tzs.channels.find((channel: any) => channel.key === "NOLSAF_MARKETPLACE");
    expect(marketplace.reservations).toBe(1);
    // Gross from the booking, net after the payout invoice's commission.
    expect(marketplace.grossRevenue).toBe(495_000);
    expect(marketplace.commission).toBe(45_000);
    // The card stops saying "no marketplace bookings in this period".
    const readiness = response.body.readiness.find((row: any) => row.key === "NOLSAF_MARKETPLACE");
    expect(readiness.state).toBe("LIVE");
  });
});
