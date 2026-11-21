// Tenant ID check routes: traveller accounts only, never during a support
// session, phone verified first, private upload only, decided once by an admin.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.LONG_STAY_ID_HASH_SECRET = "test-secret";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    user: { findUnique: fn(), findFirst: fn() },
    userDocument: { create: fn(), update: fn() },
    auditLog: { findMany: fn(), create: fn() },
    longStayTenantProfile: { findUnique: fn(), upsert: fn(), findMany: fn(), findFirst: fn(), count: fn(), groupBy: fn(), updateMany: fn(), update: fn() },
  };
  return { db, session: { user: { id: 20, role: "CUSTOMER" } as any } };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined), auditOrThrow: vi.fn(async () => undefined) }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: vi.fn(async () => undefined), notifyUser: vi.fn(async () => undefined) }));
vi.mock("../lib/redisRateLimitStore.js", () => ({ rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../lib/userDocumentSecurity.js", () => ({ isTrustedUserDocumentUrl: (url: string) => url.startsWith("https://res.cloudinary.com/") }));
vi.mock("../lib/travellerDocuments.js", () => ({
  isTravellerDocumentPublicId: (v: unknown) => typeof v === "string" && v.startsWith("traveller-documents/") && !v.includes(".."),
  signedTravellerDocumentUrl: (id: string) => `https://signed.example/${id}`,
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during a support session" }) : next()),
}));

import customerRouter from "../routes/customer.longStay.js";
import adminRouter from "../routes/admin.longStay.js";
import { notifyUser } from "../lib/notifications.js";
import { auditOrThrow } from "../lib/audit.js";

const app = express();
app.use(express.json());
app.use("/api/customer/long-stay", customerRouter);
app.use("/api/admin/long-stay", adminRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const photo = (name: string) => ({
  publicId: `traveller-documents/long-stay-id/${name}`,
  resourceType: "image",
  url: `https://res.cloudinary.com/demo/image/authenticated/v1/traveller-documents/long-stay-id/${name}.jpg`,
});
const body = {
  idType: "NATIONAL_ID",
  idCountry: "TZ",
  idNumber: "19900101-12345-00001-12",
  holderName: "Joseph Kimaro",
  dateOfBirth: "1990-01-01",
  expiresOn: "2035-01-01",
  front: photo("front"),
  back: photo("back"),
  selfie: photo("selfie"),
};
const pending = { id: 1, userId: 20, status: "PENDING", documentId: 5, documentBackId: 6, selfieDocumentId: 7, barredAt: null, submittedAt: new Date("2026-11-20T00:00:00Z"), idExpiresOn: new Date("2035-01-01T00:00:00Z") };
const viewed = (sides: string[]) => sides.map((side) => ({ afterJson: { profileId: 1, side } }));
const checks = { nameMatches: true, faceMatches: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.session.user = { id: 20, role: "CUSTOMER" };
  h.db.user.findUnique.mockResolvedValue({ phoneVerifiedAt: new Date(), suspendedAt: null });
  h.db.longStayTenantProfile.findUnique.mockResolvedValue(null);
  let nextDoc = 5;
  h.db.userDocument.create.mockImplementation(async () => ({ id: nextDoc++ }));
  h.db.auditLog.findMany.mockResolvedValue(viewed(["front", "back", "selfie"]));
  h.db.userDocument.update.mockResolvedValue({ id: 5 });
  h.db.longStayTenantProfile.upsert.mockImplementation(async ({ create }: any) => ({ id: 1, ...create }));
});

describe("tenant submits an ID", () => {
  it("stores a hash and last 4, never the number, and alerts admins", async () => {
    const res = await request(app).put("/api/customer/long-stay/identity").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "PENDING", idNumberLast4: "0112" });
    const saved = h.db.longStayTenantProfile.upsert.mock.calls[0][0];
    expect(JSON.stringify(saved)).not.toContain("19900101123450000112");
    expect(saved.create).toMatchObject({ userId: 20, idType: "NATIONAL_ID", idCountry: "TZ", nationality: "TZ", holderName: "Joseph Kimaro", status: "PENDING", documentId: 5, documentBackId: 6, selfieDocumentId: 7 });
    expect(h.db.userDocument.create).toHaveBeenCalledTimes(3);
    expect(h.db.userDocument.create.mock.calls[2][0].data).toMatchObject({ type: "SELFIE", metadata: { side: "selfie" } });
    expect(JSON.stringify(res.body)).not.toContain(saved.create.idNumberHash);
  });

  it("is refused in a support session, for non-travellers and before the phone is verified", async () => {
    h.session.user = { id: 20, role: "CUSTOMER", imp: true };
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(403);
    h.session.user = { id: 21, role: "OWNER" };
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(403);
    h.session.user = { id: 20, role: "CUSTOMER" };
    h.db.user.findUnique.mockResolvedValue({ phoneVerifiedAt: null, suspendedAt: null });
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(409);
    expect(h.db.longStayTenantProfile.upsert).not.toHaveBeenCalled();
  });

  it("refuses a public or foreign upload", async () => {
    expect((await request(app).put("/api/customer/long-stay/identity").send({ ...body, front: { ...body.front, publicId: "uploads/abc" } })).status).toBe(400);
    expect((await request(app).put("/api/customer/long-stay/identity").send({ ...body, selfie: { ...body.selfie, url: "https://evil.example/x.jpg" } })).status).toBe(400);
    expect(h.db.userDocument.create).not.toHaveBeenCalled();
  });

  it("refuses an expired document or a minor", async () => {
    expect((await request(app).put("/api/customer/long-stay/identity").send({ ...body, expiresOn: "2020-01-01" })).status).toBe(400);
    expect((await request(app).put("/api/customer/long-stay/identity").send({ ...body, dateOfBirth: "2015-01-01" })).status).toBe(400);
    expect(h.db.userDocument.create).not.toHaveBeenCalled();
  });

  it("lets an approved ID be replaced only near expiry", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ status: "APPROVED", barredAt: null, idExpiresOn: new Date(Date.now() + 20 * 86_400_000) });
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(200);
  });

  it("cannot replace an approved ID or get round a bar", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ status: "APPROVED", barredAt: null, idExpiresOn: new Date("2034-01-01T00:00:00Z") });
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(409);
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ status: "REJECTED", barredAt: new Date() });
    expect((await request(app).put("/api/customer/long-stay/identity").send(body)).status).toBe(403);
    expect(h.db.longStayTenantProfile.upsert).not.toHaveBeenCalled();
  });
});

describe("admin reviews", () => {
  beforeEach(() => { h.session.user = { id: 1, role: "ADMIN" }; });

  it("is admin only", async () => {
    h.session.user = { id: 20, role: "CUSTOMER" };
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks })).status).toBe(403);
  });

  it("decides a pending check once, and tells the tenant", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue(pending);
    h.db.longStayTenantProfile.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks });
    expect(first.status).toBe(200);
    expect(h.db.longStayTenantProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, status: "PENDING", barredAt: null } }));
    expect(notifyUser).toHaveBeenCalledWith(20, "long_stay_id_approved", expect.anything());
    expect(h.db.userDocument.update).toHaveBeenCalledTimes(3);
    const second = await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks });
    expect(second.status).toBe(409);
  });

  it("will not approve until the name and face are confirmed and every photo was opened", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue(pending);
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks: { nameMatches: true, faceMatches: false } })).status).toBe(400);
    h.db.auditLog.findMany.mockResolvedValue([...viewed(["front", "back"]), { afterJson: { profileId: 99, side: "selfie" } }]);
    const res = await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks });
    expect(res.status).toBe(409);
    expect(res.body.missing).toEqual(["selfie"]);
    expect(h.db.longStayTenantProfile.updateMany).not.toHaveBeenCalled();
    expect(h.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ actorId: 1, action: "LONG_STAY_TENANT_ID_VIEW", createdAt: { gte: pending.submittedAt } }) }));
  });

  it("will not approve an expired document", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ ...pending, idExpiresOn: new Date("2026-01-01T00:00:00Z") });
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks })).status).toBe(409);
  });

  it("needs a reason to reject or bar, and an admin cannot review their own ID", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ id: 1, userId: 1, status: "PENDING", barredAt: null });
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "REJECT" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/tenants/1/bar").send({ action: "BAR" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/tenants/1/review").send({ decision: "APPROVE", checks })).status).toBe(403);
  });

  it("opens each photo only through a signed link, and records the view", async () => {
    h.db.longStayTenantProfile.findUnique.mockResolvedValue({ id: 1, userId: 20, selfieDocument: { metadata: { cloudinaryPublicId: "traveller-documents/long-stay-id/me" } } });
    const res = await request(app).get("/api/admin/long-stay/tenants/1/document?side=selfie");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://signed.example/traveller-documents/long-stay-id/me");
    expect(auditOrThrow).toHaveBeenCalledWith(expect.anything(), expect.anything(), "LONG_STAY_TENANT_ID_VIEW", "USER", null, { profileId: 1, side: "selfie" }, 20);
    expect((await request(app).get("/api/admin/long-stay/tenants/1/document?side=other")).status).toBe(400);
  });

  it("flags the same ID number on other accounts", async () => {
    h.db.longStayTenantProfile.findMany.mockResolvedValue([{ id: 1, userId: 20, status: "PENDING", idType: "NATIONAL_ID", idCountry: "TZ", nationality: "TZ", idNumberLast4: "0112", idNumberHash: "h1", holderName: "KIMARO, JOSEPH", dateOfBirth: new Date("1990-01-01T00:00:00Z"), idExpiresOn: new Date("2035-01-01T00:00:00Z"), submittedAt: new Date(), reviewedAt: null, rejectReason: null, barReason: null, barredAt: null, documentId: 5, documentBackId: 6, selfieDocumentId: 7, user: { name: "Joseph Kimaro", fullName: null, email: "a@x", phone: "+255", phoneVerifiedAt: new Date(), createdAt: new Date() } }]);
    h.db.longStayTenantProfile.groupBy.mockResolvedValue([{ idNumberHash: "h1", _count: { _all: 3 } }]);
    h.db.longStayTenantProfile.count.mockResolvedValue(4);
    h.db.longStayTenantProfile.findFirst.mockResolvedValue({ submittedAt: new Date("2026-11-21T06:00:00Z") });
    const res = await request(app).get("/api/admin/long-stay/tenants?status=PENDING&q=kimaro&idType=NATIONAL_ID&country=TZ");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ sameIdOnOtherAccounts: 2, idNumberLast4: "0112", nameAgreement: "MATCH", photos: { front: true, back: true, selfie: true }, idExpiresOn: "2035-01-01" });
    expect(res.body.counts).toMatchObject({ PENDING: 4, EXPIRING: 4 });
    expect(JSON.stringify(h.db.longStayTenantProfile.findMany.mock.calls[0][0].where)).toContain("NATIONAL_ID");
    expect((await request(app).get("/api/admin/long-stay/tenants?status=NOPE")).status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("h1");
  });
});
