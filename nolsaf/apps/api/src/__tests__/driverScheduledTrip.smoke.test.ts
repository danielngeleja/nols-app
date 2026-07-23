import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Bypass authentication / driver-approval gating so this smoke test can focus
// on how GET /api/driver/trips/4 responds for different TransportBooking.status values.
vi.mock("../middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth.js")>();
  const passthrough = () => (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: "DRIVER" };
    next();
  };
  const requireAuth = (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: "DRIVER" };
    next();
  };
  return {
    ...actual,
    requireAuth,
    requireRole: passthrough,
    default: passthrough,
  };
});

vi.mock("../middleware/requireApprovedDriver.js", () => ({
  requireApprovedDriver: (_req: any, _res: any, next: any) => next(),
}));

const findUniqueMock = vi.fn();

// `prisma.transportBooking` is swapped out for a mock while every other model
// delegate continues to forward to the real client (lazy — no DB connection
// is made unless a query actually runs).
vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nolsaf/prisma")>();
  const transportBookingMock = { findUnique: findUniqueMock };
  const prisma = new Proxy(actual.prisma as any, {
    get(target, prop, _receiver) {
      if (prop === "transportBooking") return transportBookingMock;
      return Reflect.get(target, prop, target);
    },
  });
  return { ...actual, prisma, typedPrisma: prisma };
});

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  const mod = await import("../index");
  app = (mod as any).app;
}, 30000);

afterEach(() => {
  findUniqueMock.mockReset();
});

const PASSENGER = { id: 10, name: "Passenger", phone: "0700000000" };

function tripFour(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    // Driver 1 is the assigned driver, so the trip-detail access check passes.
    driverId: 1,
    status,
    scheduledDate: new Date("2026-07-01T09:00:00Z"),
    pickupTime: new Date("2026-07-01T09:00:00Z"),
    dropoffTime: null,
    fromLatitude: -6.816,
    fromLongitude: 39.286,
    toLatitude: -6.766,
    toLongitude: 39.255,
    fromAddress: "Kariakoo Market",
    pickupLocation: "Terminal 1",
    fromRegion: "Dar es Salaam",
    toAddress: "Mikocheni Light Industry",
    toRegion: "Dar es Salaam",
    tripCode: "TRP-0004",
    paymentRef: "PAY-0004",
    amount: 50000,
    currency: "TZS",
    paymentStatus: "PAID",
    notes: null,
    createdAt: new Date("2026-06-20T12:00:00Z"),
    updatedAt: new Date("2026-06-20T12:00:00Z"),
    user: PASSENGER,
    _count: { messages: 0, driverLocationPings: 0 },
    ...overrides,
  };
}

describe("GET /api/driver/trips/4 — scheduled trip status smoke test", () => {
  const statuses = ["PENDING_ASSIGNMENT", "CONFIRMED", "IN_PROGRESS", "COMPLETED"];

  for (const status of statuses) {
    it(`returns trip 4 with status ${status}`, async () => {
      findUniqueMock.mockResolvedValue(tripFour(status) as any);

      const res = await request(app).get("/api/driver/trips/4");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(4);
      expect(res.body.tripCode).toBe("TRP-0004");
      expect(res.body.status).toBe(status);
      expect(res.body.pickupAddress).toBe("Kariakoo Market");
      expect(res.body.dropoffAddress).toBe("Mikocheni Light Industry");
      expect(res.body.passengerName).toBe("Passenger");
    });
  }

  it("returns 404 when trip 4 does not belong to this driver or does not exist", async () => {
    findUniqueMock.mockResolvedValue(null as any);

    const res = await request(app).get("/api/driver/trips/4");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Trip not found");
  });
});
