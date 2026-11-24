// Tenant ID check routes: traveller accounts only, never during a support
// session, phone verified first, private upload only, decided once by an admin.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.LONG_STAY_ID_HASH_SECRET = "test-secret";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    user: { findUnique: fn(), findFirst: fn(), findMany: fn() },
    property: { findMany: fn() },
    tenancy: { count: fn(), findMany: fn() },
    userDocument: { create: fn(), update: fn() },
    auditLog: { findMany: fn(), create: fn() },
    $transaction: fn(),
    longStayTenantProfile: { findUnique: fn(), upsert: fn(), findMany: fn(), findFirst: fn(), count: fn(), groupBy: fn(), updateMany: fn(), update: fn() },
  };
  return { db, tx: { notification: { create: fn() } }, createReservation: fn(), publish: fn(), session: { user: { id: 20, role: "CUSTOMER" } as any } };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined), auditOrThrow: vi.fn(async () => undefined) }));
vi.mock("../lib/notifications.js", async (original) => ({
  ...await original<typeof import("../lib/notifications.js")>(),
  notifyAdmins: vi.fn(async () => undefined), notifyUser: vi.fn(async () => undefined), publishUserNotification: h.publish,
}));
vi.mock("../lib/longStay/offerService.js", async (original) => ({
  ...await original<typeof import("../lib/longStay/offerService.js")>(), createReservation: h.createReservation,
}));
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
const reservationRef = "tn_0123456789abcdefghijkl";
const reserveBody = { property: "0123456789abcdefghij", moveInDate: "2026-12-10", termMonths: 6 };

describe("traveller long-stay booking list", () => {
  it("paginates across the action-first boundary within the tenant's own bookings", async () => {
    h.db.tenancy.count.mockResolvedValueOnce(34).mockResolvedValueOnce(120).mockResolvedValueOnce(34).mockResolvedValueOnce(13);
    h.db.tenancy.findMany
      .mockResolvedValueOnce([{ publicRef: "priority", propertyId: 5, landlordId: 44, status: "AWAITING_PAYMENT" }])
      .mockResolvedValueOnce([{ publicRef: "regular", propertyId: 5, landlordId: 44, status: "OFFERED" }]);
    h.db.property.findMany.mockResolvedValueOnce([{ id: 5, title: "Sea View" }]);
    h.db.user.findMany.mockResolvedValueOnce([{ id: 44, fullName: "Private Landlord" }]);
    const response = await request(app).get("/api/customer/long-stay/tenancies").query({ page: 2 }).expect(200);
    expect(response.body).toMatchObject({ counts: { open: 34, closed: 120 }, pagination: { page: 2, pageSize: 10, total: 34 } });
    expect(response.body.items).toMatchObject([
      { ref: "priority", homeTitle: "Sea View", otherPartyName: null },
      { ref: "regular", homeTitle: "Sea View", otherPartyName: null },
    ]);
    const ownedCurrent = expect.objectContaining({ tenantId: 20, status: { notIn: ["CANCELLED", "ENDED"] } });
    const action = { OR: [{ status: { in: ["AWAITING_PAYMENT", "MOVE_IN"] } }, { status: "ACCEPTED", tenantLeaseAcceptedAt: null }] };
    const order = [{ updatedAt: "desc" }, { id: "desc" }];
    expect(h.db.tenancy.findMany).toHaveBeenNthCalledWith(1, { where: { AND: [ownedCurrent, action] }, orderBy: order, skip: 10, take: 3 });
    expect(h.db.tenancy.findMany).toHaveBeenNthCalledWith(2, { where: { AND: [ownedCurrent, { NOT: action }] }, orderBy: order, skip: 0, take: 7 });
  });

  it("searches by property or reference inside the filtered history before clamping pages", async () => {
    h.db.tenancy.count.mockResolvedValueOnce(3).mockResolvedValueOnce(120).mockResolvedValueOnce(12);
    h.db.tenancy.findMany.mockResolvedValueOnce([]);
    const response = await request(app).get("/api/customer/long-stay/tenancies")
      .query({ page: 100, scope: "closed", filter: "ended", q: "Sea View", sort: "move-in" }).expect(200);
    expect(response.body.pagination).toEqual({ page: 2, pageSize: 10, total: 12 });
    expect(h.db.tenancy.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        tenantId: 20,
        status: { in: ["CANCELLED", "ENDED"] },
        AND: [{ status: "ENDED" }, { OR: [{ publicRef: { contains: "Sea View" } }, { property: { is: { title: { contains: "Sea View" } } } }] }],
      },
      orderBy: [{ moveInDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
      skip: 10, take: 10,
    });
  });

  it("rejects an invalid page and preserves the original response for unpaged callers", async () => {
    h.db.tenancy.findMany.mockResolvedValueOnce([]);
    await request(app).get("/api/customer/long-stay/tenancies").query({ page: 0 }).expect(400);
    const legacy = await request(app).get("/api/customer/long-stay/tenancies").expect(200);
    expect(legacy.body).toEqual({ items: [] });
    expect(h.db.tenancy.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ take: 100 }));
  });
});

describe("reservation notifications", () => {
  it("stores the owner alert inside the reservation transaction and publishes after it commits", async () => {
    const commit = vi.fn();
    h.db.$transaction.mockImplementationOnce(async (operation: (tx: typeof h.tx) => unknown) => {
      const result = await operation(h.tx);
      commit();
      return result;
    });
    const response = await request(app).post("/api/customer/long-stay/reservations").send(reserveBody).expect(201);
    expect(response.body).toEqual({ ref: reservationRef, status: "OFFERED" });
    expect(h.createReservation).toHaveBeenCalledWith(h.tx, expect.objectContaining({ tenantId: 20, termMonths: 6 }));
    expect(h.tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 44, ownerId: 44, type: "booking", unread: true,
      meta: expect.objectContaining({ tenancyRef: reservationRef, notificationKind: "long_stay_reservation_received" }),
    }) });
    expect(h.publish).toHaveBeenCalledWith(expect.objectContaining({ id: 9, userId: 44 }), "long_stay_reservation_received");
    expect(h.tx.notification.create.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(h.publish.mock.invocationCallOrder[0]);
  });

  it("fails the transaction without broadcasting if the owner alert cannot be saved", async () => {
    h.tx.notification.create.mockRejectedValueOnce(new Error("Could not save notification"));
    await request(app).post("/api/customer/long-stay/reservations").send(reserveBody).expect(500);
    expect(h.publish).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  h.session.user = { id: 20, role: "CUSTOMER" };
  h.db.user.findUnique.mockResolvedValue({ phoneVerifiedAt: new Date(), suspendedAt: null });
  h.db.longStayTenantProfile.findUnique.mockResolvedValue(null);
  h.db.$transaction.mockImplementation(async (operation: (tx: typeof h.tx) => unknown) => operation(h.tx));
  h.createReservation.mockResolvedValue({ tenancy: { publicRef: reservationRef, status: "OFFERED" }, property: { ownerId: 44, title: "Example Apartment" } });
  h.tx.notification.create.mockResolvedValue({ id: 9, ownerId: 44, userId: 44, unread: true });
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
