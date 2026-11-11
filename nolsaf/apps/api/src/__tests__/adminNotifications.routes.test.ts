// The admin inbox: nothing is deleted by hand, actions are resolved by name,
// and reading an information-only alert settles it.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const db: any = {
    notification: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    property: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
  return { db };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 5, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import router from "../routes/admin.notifications.js";

const app = express();
app.use(express.json());
app.use("/api/admin/notifications", router);

beforeEach(() => {
  vi.clearAllMocks();
  h.db.notification.updateMany.mockResolvedValue({ count: 1 });
});

describe("admin inbox", () => {
  it("refuses manual deletion", async () => {
    const res = await request(app).delete("/api/admin/notifications/12");
    expect(res.status).toBe(405);
    expect(res.body.message).toMatch(/cannot be deleted/);
    expect(h.db.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("reading an information-only alert settles it, with who read it", async () => {
    h.db.notification.findFirst.mockResolvedValue({ id: 12, unread: true, type: "property", meta: { notificationKind: "property_approved" }, requiresAction: false, readById: null, resolvedAt: null });
    const res = await request(app).post("/api/admin/notifications/12/mark-read");
    expect(res.body).toMatchObject({ ok: true, state: "resolved" });
    expect(h.db.notification.updateMany.mock.calls[0][0].data).toMatchObject({ unread: false, readById: 5, resolvedById: 5 });
  });

  it("reading an alert that asks for action leaves it open", async () => {
    h.db.notification.findFirst.mockResolvedValue({ id: 13, unread: true, type: "invoice", meta: { notificationKind: "payout_disbursement_failed" }, requiresAction: true, readById: null, resolvedAt: null });
    const res = await request(app).post("/api/admin/notifications/13/mark-read");
    expect(res.body).toMatchObject({ ok: true, state: "open" });
    expect(h.db.notification.updateMany.mock.calls[0][0].data).not.toHaveProperty("resolvedAt");
  });

  it("resolving records the admin and an optional note, once", async () => {
    h.db.notification.findFirst.mockResolvedValue({ id: 13, unread: false, type: "invoice", meta: { notificationKind: "payout_disbursement_failed", disbursementId: 4 }, requiresAction: true, readById: 2, resolvedAt: null });
    const res = await request(app).post("/api/admin/notifications/13/resolve").send({ note: "Re-sent with the corrected account" });
    expect(res.body).toMatchObject({ ok: true, state: "resolved" });
    const call = h.db.notification.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 13, resolvedAt: null });
    expect(call.data).toMatchObject({ resolvedById: 5, meta: { disbursementId: 4, resolutionNote: "Re-sent with the corrected account" } });
    expect(call.data).not.toHaveProperty("readById");
  });

  it("mark all read covers the whole inbox and keeps action alerts open", async () => {
    h.db.notification.findMany.mockResolvedValue([
      { id: 1, type: "property", meta: { notificationKind: "property_approved" }, requiresAction: false },
      { id: 2, type: "invoice", meta: { notificationKind: "payment_unmatched" }, requiresAction: true },
    ]);
    const res = await request(app).post("/api/admin/notifications/mark-all-read");
    expect(res.body).toMatchObject({ ok: true, marked: 2, stillOpen: 1 });
    const [actionCall, infoCall] = h.db.notification.updateMany.mock.calls.map((c: any) => c[0]);
    expect(actionCall.where.id.in).toEqual([2]);
    expect(actionCall.data).not.toHaveProperty("resolvedAt");
    expect(infoCall.where.id.in).toEqual([1]);
    expect(infoCall.data).toMatchObject({ resolvedById: 5 });
  });
});
