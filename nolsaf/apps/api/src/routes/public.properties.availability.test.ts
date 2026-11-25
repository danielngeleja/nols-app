import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calculateAvailabilityMock, db } = vi.hoisted(() => ({
  calculateAvailabilityMock: vi.fn(),
  db: {
    $queryRaw: vi.fn(),
    property: { count: vi.fn() },
    propertyReview: { groupBy: vi.fn() },
    longStayListing: { findMany: vi.fn() },
    longStayInspection: { findMany: vi.fn() },
  },
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: db }));
vi.mock("../lib/performance.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/performance.js")>(),
  withCache: (_key: string, load: () => unknown) => load(),
}));

vi.mock("../lib/availabilityCalculator.js", () => ({
  calculateAvailability: calculateAvailabilityMock,
}));

import publicPropertiesRouter from "./public.properties.js";
import { extractPublicKeyFromSlug } from "../lib/publicPropertyKey.js";

describe("public property availability room identity", () => {
  beforeEach(() => {
    calculateAvailabilityMock.mockReset();
    calculateAvailabilityMock.mockResolvedValue({
      restrictions: [],
      summary: {
        totalSellableRooms: 2,
        totalRooms: 2,
        totalAvailableRooms: 2,
      },
    });
  });

  it("passes the HTTP roomCode query to the calculator's exact-code argument", async () => {
    const app = express();
    app.use("/api/public/properties", publicPropertiesRouter);

    const response = await request(app).get(
      "/api/public/properties/availability?ids=7&checkIn=2026-09-10&checkOut=2026-09-17&roomCode=Double%201%20Full",
    );

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ id: 7, roomsAvailable: 2 });
    expect(calculateAvailabilityMock).toHaveBeenCalledWith(
      7,
      expect.any(Date),
      expect.any(Date),
      "Double 1 Full",
      undefined,
    );
  });

  it("does not resolve the legacy numeric public-property slug", async () => {
    const app = express();
    app.use("/api/public/properties", publicPropertiesRouter);

    const response = await request(app).get("/api/public/properties/diary-hotel-10");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "property_not_found" });
  });
});

describe("approved browse cards", () => {
  it("returns the nightly rate and the monthly rate with a public slug in the same result", async () => {
    const app = express();
    app.use("/api/public/properties", publicPropertiesRouter);
    const publicKey = "cmg7t4q9v0001abcd2efghijk";
    db.$queryRaw.mockResolvedValueOnce([{ id: 11 }, { id: 10 }]).mockResolvedValueOnce([
      { id: 10, title: "Diary Hotel", rentalMode: "NIGHTLY", basePrice: 110000, nrmsBookingKey: "xyz7t4q9v0001abcd2efghijk" },
      { id: 11, title: "Majaliwa Home", rentalMode: "LONG_STAY", nrmsBookingKey: publicKey },
    ]);
    db.property.count.mockResolvedValue(2);
    db.propertyReview.groupBy.mockResolvedValue([]);
    db.longStayListing.findMany.mockResolvedValue([{ propertyId: 11, monthlyRent: "450000", currency: "TZS" }]);
    db.longStayInspection.findMany.mockResolvedValue([]);

    const response = await request(app).get("/api/public/properties?rental=all");
    expect(response.status).toBe(200);
    expect(response.body.items).toMatchObject([
      { id: 11, slug: `majaliwa-home-${publicKey}`, rentalMode: "LONG_STAY", basePrice: null, longStay: { monthlyRent: 450000, currency: "TZS", inspected: false } },
      { id: 10, rentalMode: "NIGHTLY", basePrice: 110000, longStay: null },
    ]);
    expect(extractPublicKeyFromSlug(response.body.items[0].slug)).toBe(publicKey);
    expect(db.property.count).toHaveBeenCalledWith({ where: { status: "APPROVED" } });
  });
});
