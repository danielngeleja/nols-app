import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingCount: vi.fn(), bookingFindFirst: vi.fn(), bookingFindMany: vi.fn(),
  gestureFindMany: vi.fn(), gestureUpdateMany: vi.fn(),
  prefFindUnique: vi.fn(), prefUpsert: vi.fn(), prefDeleteMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  booking: { count: mocks.bookingCount, findFirst: mocks.bookingFindFirst, findMany: mocks.bookingFindMany },
  karibuGesture: { findMany: mocks.gestureFindMany, updateMany: mocks.gestureUpdateMany },
  karibuGuestPreference: { findUnique: mocks.prefFindUnique, upsert: mocks.prefUpsert, deleteMany: mocks.prefDeleteMany },
} }));
vi.mock("../middleware/auth.js", () => ({ requireAuth: (req: any, _res: unknown, next: () => void) => {
  req.user = { id: 23, role: "USER" }; next();
} }));
vi.mock("../lib/customerBookingReference.js", () => ({ customerBookingReference: (id: number) => `bk_${id}` }));

import customerKaribuRouter from "./customer.karibu.js";

const app = express();
app.use(express.json());
app.use("/api/customer/karibu", customerKaribuRouter);

describe("customer Karibu journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingCount.mockResolvedValue(1);
    mocks.bookingFindFirst.mockResolvedValue({ id: 7, checkOut: new Date("2026-10-01"), property: { title: "Ocean Lodge" } });
    mocks.gestureFindMany.mockResolvedValue([]);
    mocks.bookingFindMany.mockResolvedValue([]);
  });

  it("shows only this account's issued moments and no finance data", async () => {
    mocks.gestureFindMany.mockResolvedValue([{ id: 9, bookingId: 7, status: "SERVED", issuedAt: new Date(), servedAt: new Date(),
      guestFeedbackAt: null, partnerPrice: 3000, order: { items: [{ nameSnapshot: "Mango juice" }] } }]);
    mocks.bookingFindMany.mockResolvedValue([{ id: 7, checkIn: new Date("2026-09-29"), property: { title: "Ocean Lodge" } }]);
    const response = await request(app).get("/api/customer/karibu");
    expect(response.status).toBe(200);
    expect(mocks.gestureFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 23, status: { in: ["ORDERED", "SERVED"] } } }));
    expect(mocks.bookingFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [7] }, userId: 23 } }));
    expect(response.body.moments).toEqual([expect.objectContaining({ bookingReference: "bk_7", drink: "Mango juice", status: "SERVED" })]);
    expect(JSON.stringify(response.body)).not.toContain("partnerPrice");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("builds the travel story from completed stays without exposing row ids", async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { id: 7, checkIn: new Date("2026-09-29"), checkOut: new Date("2026-10-01"), property: { title: "Ocean Lodge", city: "Zanzibar" } },
      { id: 5, checkIn: new Date("2026-03-02"), checkOut: new Date("2026-03-05"), property: { title: "City Inn", city: "zanzibar " } },
    ]);
    const response = await request(app).get("/api/customer/karibu");
    expect(response.status).toBe(200);
    expect(response.body.totals).toEqual({ nights: 5, places: 1 });
    expect(response.body.recentStays[0]).toEqual(expect.objectContaining({ bookingReference: "bk_7", nights: 2, welcomed: false }));
    expect(JSON.stringify(response.body.recentStays)).not.toContain('"id"');
  });

  it("records delivery feedback only once for a served moment owned by this account", async () => {
    mocks.gestureUpdateMany.mockResolvedValue({ count: 1 });
    const response = await request(app).post("/api/customer/karibu/9/feedback")
      .send({ received: false, rating: null, note: "<b>Never reached my room</b>" });
    expect(response.status).toBe(200);
    expect(mocks.gestureUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, userId: 23, status: "SERVED", guestFeedbackAt: null },
      data: expect.objectContaining({ guestConfirmedReceived: false, guestFeedbackRating: null, guestFeedbackNote: "Never reached my room" }),
    }));
  });

  it("rejects duplicate or unauthorised feedback", async () => {
    mocks.gestureUpdateMany.mockResolvedValue({ count: 0 });
    const response = await request(app).post("/api/customer/karibu/9/feedback")
      .send({ received: true, rating: 5, note: null });
    expect(response.status).toBe(409);
  });

  it("requires a rating when the guest says the welcome arrived", async () => {
    const response = await request(app).post("/api/customer/karibu/9/feedback")
      .send({ received: true, rating: null });
    expect(response.status).toBe(400);
    expect(mocks.gestureUpdateMany).not.toHaveBeenCalled();
  });
});

describe("customer Karibu preferences", () => {
  const base = { celebrateOptIn: false, birthday: null, drinkLikes: [], dietaryTags: [], dietaryNote: null, shareWithProperty: false };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefUpsert.mockImplementation(async ({ create }: any) => ({ ...create, updatedAt: new Date("2026-10-09") }));
  });

  it("starts empty and off for a guest with no saved preferences", async () => {
    mocks.prefFindUnique.mockResolvedValue(null);
    const response = await request(app).get("/api/customer/karibu/preferences");
    expect(response.body).toEqual({ available: true, preferences: expect.objectContaining({ celebrateOptIn: false, shareWithProperty: false, birthday: null, drinkLikes: [] }) });
  });

  it("reports preferences as unavailable until the table is migrated", async () => {
    mocks.prefFindUnique.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    const response = await request(app).get("/api/customer/karibu/preferences");
    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
  });

  it("requires the guest to confirm a birthday is their own before celebrating it", async () => {
    const response = await request(app).put("/api/customer/karibu/preferences").send({ ...base, celebrateOptIn: true, birthday: { day: 14, month: 2 } });
    expect(response.status).toBe(400);
    expect(mocks.prefUpsert).not.toHaveBeenCalled();
  });

  it("rejects a date that does not exist", async () => {
    const response = await request(app).put("/api/customer/karibu/preferences").send({ ...base, celebrateOptIn: true, birthday: { day: 31, month: 4 }, birthdayIsMine: true });
    expect(response.status).toBe(400);
  });

  it("stores day and month only, and drops the birthday when celebrating is off", async () => {
    await request(app).put("/api/customer/karibu/preferences").send({ ...base, celebrateOptIn: true, birthday: { day: 29, month: 2 }, birthdayIsMine: true, drinkLikes: ["FRESH_JUICE", "FRESH_JUICE"] });
    expect(mocks.prefUpsert).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 23 }, create: expect.objectContaining({ birthdayDay: 29, birthdayMonth: 2, drinkLikes: ["FRESH_JUICE"] }) }));
    await request(app).put("/api/customer/karibu/preferences").send({ ...base, celebrateOptIn: false, birthday: { day: 29, month: 2 } });
    expect(mocks.prefUpsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: expect.objectContaining({ birthdayDay: null, birthdayMonth: null }) }));
  });

  it("rejects unknown drink or dietary values", async () => {
    const response = await request(app).put("/api/customer/karibu/preferences").send({ ...base, drinkLikes: ["WHISKY"] });
    expect(response.status).toBe(400);
  });

  it("clears everything for this account only", async () => {
    mocks.prefDeleteMany.mockResolvedValue({ count: 1 });
    const response = await request(app).delete("/api/customer/karibu/preferences");
    expect(response.status).toBe(200);
    expect(mocks.prefDeleteMany).toHaveBeenCalledWith({ where: { userId: 23 } });
  });
});

describe("customer Karibu places", () => {
  it("counts a stay as a place even when its property has no city", async () => {
    vi.clearAllMocks();
    mocks.bookingCount.mockResolvedValue(1);
    mocks.bookingFindFirst.mockResolvedValue(null);
    mocks.gestureFindMany.mockResolvedValue([]);
    mocks.bookingFindMany.mockResolvedValue([{ id: 7, propertyId: 4, checkIn: new Date("2026-01-22"), checkOut: new Date("2026-01-28"), property: { title: "Sheraton Hotel", city: null, district: null, regionName: "Dar es Salaam" } }]);
    const response = await request(app).get("/api/customer/karibu");
    expect(response.body.totals).toEqual({ nights: 6, places: 1 });
    expect(response.body.recentStays[0].city).toBe("Dar es Salaam");
  });
});

describe("customer Karibu sharing switch", () => {
  it("changes only the sharing choice", async () => {
    vi.clearAllMocks();
    mocks.prefUpsert.mockImplementation(async ({ update }: any) => ({ ...update, drinkLikes: ["WATER"], updatedAt: new Date() }));
    const response = await request(app).patch("/api/customer/karibu/preferences/sharing").send({ shareWithProperty: true });
    expect(response.status).toBe(200);
    expect(mocks.prefUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 23 }, update: { shareWithProperty: true } }));
    expect(response.body.preferences).toEqual(expect.objectContaining({ shareWithProperty: true, drinkLikes: ["WATER"] }));
  });

  it("rejects anything but on or off", async () => {
    const response = await request(app).patch("/api/customer/karibu/preferences/sharing").send({ shareWithProperty: "yes" });
    expect(response.status).toBe(400);
  });
});
