// Owner confirmation of sales partner claims. The real router and service run
// over HTTP; the database, auth, notifications, mail and SMS are stood in for.
// The point of these tests is that only the signed-in owner can answer.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesOwnerConfirmation: { findMany: fn(), findFirst: fn(), findUnique: fn(), updateMany: fn(), create: fn(), count: fn() },
    propertySalesAttribution: { findMany: fn(), updateMany: fn() },
    user: { findUnique: fn() },
    auditLog: { create: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, notifyUser: vi.fn(async () => undefined), sendMail: vi.fn(async () => undefined), sendSms: vi.fn(async () => ({ success: true })) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser }));
vi.mock("../lib/mailer.js", () => ({ sendMail: h.sendMail }));
vi.mock("../lib/sms.js", () => ({ sendSms: h.sendSms }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret" }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = Number(req.get("x-test-user-id"));
    if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id, role: req.get("x-test-role") || "OWNER", imp: req.get("x-test-impersonated") === "true" };
    req.sessionId = "sess-1";
    return next();
  },
  requireRole: (role: string) => (req: any, res: any, next: any) =>
    req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" }),
  blockImpersonated: (req: any, res: any, next: any) =>
    req.user?.imp ? res.status(403).json({ error: "Not during support session" }) : next(),
}));
vi.mock("../middleware/rateLimit.js", () => ({ limitOwnerSalesConfirmation: (_req: any, _res: any, next: any) => next() }));

import router from "../routes/owner.salesConfirmations.js";
import {
  hashConfirmationReference,
  requestOwnerConfirmations,
  sweepOwnerConfirmations,
} from "../lib/salesOwnerConfirmation.js";

const app = express();
app.use(express.json());
app.use("/api/owner/sales-confirmations", router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 24 * 60 * 60 * 1000;
const owner = { "x-test-user-id": "7", "x-test-role": "OWNER" };

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    status: "PENDING",
    ownerUserId: 7,
    propertyId: 4,
    salesPartnerId: 11,
    expiresAt: new Date(Date.now() + 5 * DAY),
    property: { ownerId: 7, title: "Jamirex Hotel" },
    salesPartner: { userId: 101 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  h.db.salesOwnerConfirmation.findUnique.mockResolvedValue(pendingRow());
  h.db.salesOwnerConfirmation.findMany.mockResolvedValue([{ id: 50, attributionId: 90 }, { id: 51, attributionId: 91 }]);
  h.db.salesOwnerConfirmation.updateMany.mockResolvedValue({ count: 2 });
  h.db.propertySalesAttribution.updateMany.mockResolvedValue({ count: 2 });
});

describe("who may answer", () => {
  it("needs a signed-in owner and refuses support sessions", async () => {
    const body = { answer: "CONFIRMED" };
    expect((await request(app).post("/api/owner/sales-confirmations/50/answer").send(body)).status).toBe(401);
    expect((await request(app).post("/api/owner/sales-confirmations/50/answer").set({ ...owner, "x-test-role": "SALES" }).send(body)).status).toBe(403);
    expect((await request(app).post("/api/owner/sales-confirmations/50/answer").set({ ...owner, "x-test-impersonated": "true" }).send(body)).status).toBe(403);
    expect(h.db.salesOwnerConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it("treats another owner's request as not found", async () => {
    h.db.salesOwnerConfirmation.findUnique.mockResolvedValue(pendingRow({ ownerUserId: 8, property: { ownerId: 8, title: "X" } }));
    const res = await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "CONFIRMED" });
    expect(res.status).toBe(404);
    expect(h.db.salesOwnerConfirmation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when the property changed owner after the request", async () => {
    h.db.salesOwnerConfirmation.findUnique.mockResolvedValue(pendingRow({ property: { ownerId: 9, title: "Jamirex Hotel" } }));
    const res = await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "CONFIRMED" });
    expect(res.status).toBe(404);
  });

  it("refuses an expired or already answered request", async () => {
    h.db.salesOwnerConfirmation.findUnique.mockResolvedValue(pendingRow({ expiresAt: new Date(Date.now() - DAY) }));
    expect((await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "CONFIRMED" })).status).toBe(409);
    h.db.salesOwnerConfirmation.findUnique.mockResolvedValue(pendingRow({ status: "CONFIRMED" }));
    expect((await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "DENIED" })).status).toBe(409);
  });
});

describe("answers", () => {
  it("a yes covers every open product from that partner and keeps evidence", async () => {
    const res = await request(app)
      .post("/api/owner/sales-confirmations/50/answer")
      .set(owner)
      .set("user-agent", "TestPhone/1.0")
      .send({ answer: "CONFIRMED" });
    expect(res.status).toBe(200);
    const update = h.db.salesOwnerConfirmation.updateMany.mock.calls[0][0];
    expect(update.where.id.in).toEqual([50, 51]);
    expect(update.data).toMatchObject({ status: "CONFIRMED", activeKey: null, respondedById: 7, responseUserAgent: "TestPhone/1.0", responseSessionId: "sess-1" });
    expect(update.data.responseIpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_owner_confirmed", expect.any(Object));
  });

  it("a no puts the claim on hold for review", async () => {
    const res = await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "UNKNOWN_PARTNER" });
    expect(res.status).toBe(200);
    expect(h.db.propertySalesAttribution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [90, 91] }, status: { in: ["PENDING", "VERIFIED"] } },
      data: expect.objectContaining({ status: "DISPUTED" }),
    }));
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_owner_disputed", expect.any(Object));
  });

  it("rejects answers outside the three choices", async () => {
    const res = await request(app).post("/api/owner/sales-confirmations/50/answer").set(owner).send({ answer: "APPROVED" });
    expect(res.status).toBe(400);
  });
});

describe("sidebar count", () => {
  it("counts only the signed-in owner's own requests", async () => {
    h.db.salesOwnerConfirmation.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    const res = await request(app).get("/api/owner/sales-confirmations/count").set(owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 2, answered: 5 });
    expect(h.db.salesOwnerConfirmation.count).toHaveBeenCalledWith({ where: expect.objectContaining({ ownerUserId: 7, property: { ownerId: 7 }, status: "PENDING" }) });
  });
});

describe("link references", () => {
  it("resolve only finds the signed-in owner's own request, by hash", async () => {
    h.db.salesOwnerConfirmation.findFirst.mockResolvedValue({ id: 50, status: "PENDING" });
    const reference = "abcdefghijklmnopqrstuvwxyz012345";
    const res = await request(app).post("/api/owner/sales-confirmations/resolve").set(owner).send({ reference });
    expect(res.status).toBe(200);
    expect(h.db.salesOwnerConfirmation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { referenceHash: hashConfirmationReference(reference), ownerUserId: 7, property: { ownerId: 7 } },
    }));
  });

  it("a malformed or unknown reference is simply not found", async () => {
    h.db.salesOwnerConfirmation.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/api/owner/sales-confirmations/resolve").set(owner).send({ reference: "short" })).status).toBe(404);
    expect((await request(app).post("/api/owner/sales-confirmations/resolve").set(owner).send({ reference: "abcdefghijklmnopqrstuvwxyz012345" })).status).toBe(404);
  });
});

describe("requests", () => {
  it("stores only the hash and replaces an open request", async () => {
    h.db.propertySalesAttribution.findMany.mockResolvedValue([
      { id: 90, propertyId: 4, salesPartnerId: 11, property: { ownerId: 7, title: "Jamirex Hotel" }, salesPartner: { agentCode: "NSA-1", user: { name: "Asha" } } },
    ]);
    h.db.salesOwnerConfirmation.create.mockImplementation(async ({ data }: any) => ({ id: 60, ...data }));
    const [notice] = await requestOwnerConfirmations(h.db, [90]);
    expect(h.db.salesOwnerConfirmation.updateMany).toHaveBeenCalledWith({ where: { attributionId: 90, status: "PENDING" }, data: { status: "CANCELLED", activeKey: null } });
    const data = h.db.salesOwnerConfirmation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ ownerUserId: 7, activeKey: 90, status: "PENDING" });
    expect(data.referenceHash).toBe(hashConfirmationReference(notice.reference));
    expect(JSON.stringify(data)).not.toContain(notice.reference);
  });

  it("the sweep expires overdue requests and cancels them when the owner changed", async () => {
    h.db.salesOwnerConfirmation.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesOwnerConfirmation.findMany.mockResolvedValue([
      { id: 70, ownerUserId: 7, notifiedAt: new Date(), remindedAt: null, expiresAt: new Date(Date.now() + 5 * DAY), property: { ownerId: 9, title: "A" }, salesPartner: null },
    ]);
    const result = await sweepOwnerConfirmations();
    expect(h.db.salesOwnerConfirmation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EXPIRED", activeKey: null } }));
    expect(h.db.salesOwnerConfirmation.updateMany).toHaveBeenCalledWith({ where: { id: { in: [70] }, status: "PENDING" }, data: { status: "CANCELLED", activeKey: null } });
    expect(result.cancelled).toBe(1);
  });
});
