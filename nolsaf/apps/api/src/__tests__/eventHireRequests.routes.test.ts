import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  session: { user: null as any, partnerId: 30 as number | null },
  db: { eventHireRequest: { findMany: vi.fn(), findFirst: vi.fn() }, eventHireBlock: { updateMany: vi.fn() }, property: { findFirst: vi.fn() }, propertyEventHire: { findMany: vi.fn() },eventHireBooking:{findFirst:vi.fn()} },
  gate: { failure: null as string | null },
  create: vi.fn(), decide: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/customerBookingReference.js", () => ({ customerRecordReference: (_kind: string, id: number) => `pp_test_${id}` }));
vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));
vi.mock("../lib/redisRateLimitStore.js", () => ({ rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../lib/salesAgency.js", () => ({ agencyGateFailure: (g: any) => g.failure, loadAgencyGateInput: async () => h.gate }));
vi.mock("../lib/eventHireRequests.js", async (original) => ({ ...await original<any>(), createEventRequest: h.create, decideEventRequest: h.decide }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => { if (!h.session.user) return res.status(401).json({ error: "Unauthorized" }); req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => req.user.role === role ? next() : res.status(403).json({ error: "Forbidden" }),
  blockImpersonated: (req: any, res: any, next: any) => req.user.imp ? res.status(403).json({ error: "Impersonation blocked" }) : next(),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (_req: any, res: any, next: any) => h.session.partnerId ? next() : res.status(404).json({ error: "Not found" }),
  partnerIdFor: () => h.session.partnerId,
}));
import { csrfProtection } from "../middleware/csrf.js";
import ownerEventHireRouter from "../routes/owner.eventHire.js";
import { adminEventRequestsRouter, customerEventRequestsRouter, ownerEventRequestsRouter, ownerEventAvailabilityRouter, salesEventRequestsRouter } from "../routes/eventHire.requests.js";
const app = express();
app.use(express.json());
app.use(csrfProtection);
app.use("/api/customer/event-requests", customerEventRequestsRouter);
app.use("/api/owner/event-requests", ownerEventRequestsRouter);
app.use("/api/owner/properties", ownerEventAvailabilityRouter);
app.use("/api/sales/event-requests", salesEventRequestsRouter);
app.use("/api/admin/event-requests", adminEventRequestsRouter);
app.use("/api/owner/event-hire", ownerEventHireRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: error.message }));
const ref = `er_${"a".repeat(32)}`;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVENT_HIRE_REQUESTS_ENABLED = "true";
  h.session.user = { id: 10, role: "USER" }; h.session.partnerId = 30; h.gate.failure = null;
  h.db.eventHireRequest.findMany.mockResolvedValue([]);
  h.db.eventHireRequest.findFirst.mockResolvedValue(null);
  h.db.propertyEventHire.findMany.mockResolvedValue([]);
  h.db.eventHireBooking.findFirst.mockResolvedValue(null);
});

describe("approved event hire navigation", () => {
  it("requires an owner session", async () => {
    h.session.user = null;
    expect((await request(app).get("/api/owner/event-hire/approved")).status).toBe(401);
    h.session.user = { id: 10, role: "USER" };
    expect((await request(app).get("/api/owner/event-hire/approved")).status).toBe(403);
    expect(h.db.propertyEventHire.findMany).not.toHaveBeenCalled();
  });
  it("includes only the owner's approved event hire under approved nightly properties", async () => {
    h.session.user.role = "OWNER";
    h.db.propertyEventHire.findMany.mockResolvedValue([{ property: { id: 7, title: "Hotel hall" }, terms: { spaceType: "HALL", capacitySeated: 80, capacityStanding: 100 } }]);
    const response = await request(app).get("/api/owner/event-hire/approved");
    expect(response.status).toBe(200);
    expect(h.db.propertyEventHire.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "APPROVED", property: { ownerId: 10, status: "APPROVED", rentalMode: "NIGHTLY" } } }));
    expect(response.body.items).toEqual([{ ref: "pp_test_7", title: "Hotel hall", spaceType: "HALL", capacitySeated: 80, capacityStanding: 100, photo: null, location: [], fromPrice: null, priceLabel: null, eventTypes: [] }]);
    expect(response.headers["cache-control"]).toContain("no-store");
  });
  it("does not depend on enabling event payments or requests", async () => {
    delete process.env.EVENT_HIRE_REQUESTS_ENABLED;
    h.session.user.role = "OWNER";
    expect((await request(app).get("/api/owner/event-hire/approved")).body.items).toEqual([]);
  });
  it("uses an event-space photo and the lowest offered hire rate", async () => {
    h.session.user.role = "OWNER";
    h.db.propertyEventHire.findMany.mockResolvedValue([{ property: { id: 7, title: "Hotel hall", ward: "Upanga", district: "Ilala", regionName: "Dar es Salaam", photos: ["https://example.com/bedroom.jpg", "https://example.com/hall.jpg"], photoAreas: { "https://example.com/bedroom.jpg": "BEDROOM", "https://example.com/hall.jpg": "EVENT_SPACE" } }, terms: { spaceType: "HALL", halfDayPrice: 300000, fullDayPrice: 500000, eveningPrice: 250000, eventTypes: ["MEETING"] } }]);
    const response = await request(app).get("/api/owner/event-hire/approved");
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ photo: "https://example.com/hall.jpg", fromPrice: 250000, priceLabel: "Evening", location: ["Upanga", "Ilala", "Dar es Salaam"], eventTypes: ["MEETING"] });
  });
  it("fails closed when the listing table is unavailable", async () => {
    h.session.user.role = "OWNER";
    h.db.propertyEventHire.findMany.mockRejectedValue({ code: "P2021" });
    expect((await request(app).get("/api/owner/event-hire/approved")).status).toBe(503);
  });
});

describe("private event routes", () => {
  it.each(["customer", "owner", "sales", "admin"])("requires authentication on %s", async (area) => {
    h.session.user = null;
    expect((await request(app).get(`/api/${area}/event-requests`)).status).toBe(401);
    expect(h.db.eventHireRequest.findMany).not.toHaveBeenCalled();
  });
  it("is closed by default", async () => {
    delete process.env.EVENT_HIRE_REQUESTS_ENABLED;
    expect((await request(app).get("/api/customer/event-requests")).status).toBe(404);
    expect(h.db.eventHireRequest.findMany).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("a client cannot enter the %s workspace", async (area) => {
    expect((await request(app).get(`/api/${area}/event-requests`)).status).toBe(403);
  });
  it("sales workspace membership alone is insufficient", async () => {
    h.gate.failure = "NO_CAPABILITY";
    expect((await request(app).get("/api/sales/event-requests")).status).toBe(404);
    expect(h.db.eventHireRequest.findMany).not.toHaveBeenCalled();
  });
  it.each([
    ["customer", "USER", { clientUserId: 10 }],
    ["owner", "OWNER", { property: { ownerId: 10 } }],
    ["sales", "USER", { salesPartnerId: 30 }],
  ])("applies %s scope to list and detail", async (area, role, scope) => {
    h.session.user.role = role;
    const list = await request(app).get(`/api/${area}/event-requests`);
    expect(list.status).toBe(200); expect(list.headers["cache-control"]).toContain("no-store");
    expect(h.db.eventHireRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
    expect((await request(app).get(`/api/${area}/event-requests/${ref}`)).status).toBe(404);
    expect(h.db.eventHireRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { reference: ref, ...scope } }));
  });
  it("rejects guessed numeric request IDs before querying", async () => {
    expect((await request(app).get("/api/customer/event-requests/123")).status).toBe(404);
    expect(h.db.eventHireRequest.findFirst).not.toHaveBeenCalled();
  });
  it("blocks impersonated mutation sessions", async () => {
    h.session.user.imp = true;
    expect((await request(app).post("/api/customer/event-requests").send({})).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("uses the authenticated identity for creation", async () => {
    h.create.mockResolvedValue({ reference: ref, status: "WAITING_OWNER" });
    const result = await request(app).post("/api/customer/event-requests").send({ propertyId: 7 });
    expect(result.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(h.db, { kind: "CLIENT", userId: 10 }, { propertyId: 7 });
    expect(result.body.canPay).toBe(false);
  });
  it("does not exempt event writes from CSRF", async () => {
    const result = await request(app).post("/api/customer/event-requests").set("Cookie", "nolsaf_token=test-session").set("Origin", "https://untrusted.example").set("Sec-Fetch-Site", "cross-site").send({});
    expect(result.status).toBe(403); expect(result.body.code).toBe("CSRF_TOKEN_MISSING");
    expect(h.create).not.toHaveBeenCalled();
  });
  it("does not let a foreign owner cancel a blocked slot", async () => {
    h.session.user.role = "OWNER"; h.db.eventHireBlock.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete(`/api/owner/properties/7/event-availability/eb_${"a".repeat(32)}`)).status).toBe(404);
    expect(h.db.eventHireBlock.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ property: { ownerId: 10 } }) }));
  });
  it("never sends private owner contacts or call evidence to the client", async () => {
    h.db.eventHireRequest.findFirst.mockResolvedValue({ reference: ref, status: "WAITING_OWNER", property: { title: "Venue", owner: { name: "Owner", phone: "secret-phone" } }, events: [{ action: "RECORD_CALL", createdAt: new Date(), details: { note: "secret-note" } }] });
    const result = await request(app).get(`/api/customer/event-requests/${ref}`);
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});
