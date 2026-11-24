import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "ADMIN",
  owner: vi.fn(),
  logs: vi.fn(),
  total: vi.fn(),
  counts: vi.fn(),
  recent: vi.fn(),
  destination: vi.fn(),
  notes: vi.fn(),
  saveNote: vi.fn(),
  noteAudit: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => {
  const database = {
    user: { findFirst: mocks.owner },
    auditLog: { findMany: mocks.logs, count: mocks.total, groupBy: mocks.counts, findFirst: mocks.recent },
    payoutAccount: { findFirst: mocks.destination },
    adminNote: { findMany: mocks.notes, create: mocks.saveNote },
    adminAudit: { create: mocks.noteAudit },
  };
  return { prisma: { ...database, $transaction: (run: (tx: typeof database) => unknown) => run(database) } };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: mocks.role }; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => req.user.role === role ? next() : res.sendStatus(403),
}));

import { router } from "../routes/admin.owners.js";
import { ownerActivityEvent, ownerBehaviourScore } from "../lib/ownerAccountActivity.js";

const app = express();
app.use(express.json());
app.use("/owners", router);
const createdAt = new Date("2026-11-24T08:30:00Z");
const row = {
  id: 70n, actorId: 44, actorRole: "OWNER", action: "USER_PAYOUT_DESTINATION_VERIFIED",
  afterJson: { change: "changed", provider: "NMB", accountNumber: "123456789012", previousAccountNumber: "****0045", accountName: "PRIVATE" },
  ip: "192.0.2.1", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", createdAt,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "ADMIN";
  mocks.owner.mockResolvedValue({ id: 44, twoFactorEnabled: true, twoFactorMethod: "TOTP", _count: { passkeys: 0 } });
  mocks.logs.mockResolvedValue([row]);
  mocks.total.mockResolvedValue(1);
  mocks.counts.mockResolvedValue([]);
  mocks.recent.mockResolvedValue({ id: 70n });
  mocks.destination.mockResolvedValue({ type: "BANK", provider: "NMB", accountNumber: "123456789012", destinationChangedAt: createdAt });
});

describe("owner account activity", () => {
  it("uses an admin-only route and looks up an owner record", async () => {
    mocks.role = "OWNER";
    await request(app).get("/owners/44/account-activity").expect(403);
    expect(mocks.logs).not.toHaveBeenCalled();
    mocks.role = "ADMIN";
    mocks.owner.mockResolvedValue(null);
    await request(app).get("/owners/44/account-activity").expect(404);
    expect(mocks.owner).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 44, role: "OWNER" } }));
  });

  it("shows masked payout changes and filters by an owner-scoped cursor", async () => {
    const result = await request(app).get("/owners/44/account-activity").query({ category: "payout", before: "71" }).expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toMatchObject({
      twoFactorEnabled: true, next: null,
      items: [{ id: "70", actor: "Owner", label: "Payout destination changed", detail: "NMB · Ending in 9012 · Previously ending in 0045" }],
      destination: { provider: "NMB", ending: "9012" },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/123456789012|PRIVATE|afterJson/);
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { lt: 71n },
        OR: expect.arrayContaining([{ entity: "user:44" }, { entity: "USER", entityId: 44 }]),
        action: { in: expect.arrayContaining(["USER_PAYOUT_DESTINATION_VERIFIED"]) },
      }),
    }));
    await request(app).get("/owners/44/account-activity").query({ before: "9223372036854775808" }).expect(400);
  });

  it("labels password recovery and failed sign-ins without returning credentials or contact values", () => {
    expect(ownerActivityEvent({ ...row, actorId: null, actorRole: null, action: "ACCOUNT_PASSWORD_RESET", afterJson: { resetToken: "private" } }, 44))
      .toMatchObject({ actor: "Email recovery", label: "Password reset", detail: null });
    expect(ownerActivityEvent({ ...row, action: "USER_LOGIN", afterJson: { success: false, email: "private@example.com" } }, 44))
      .toMatchObject({ label: "Sign-in failed", tone: "failed", detail: null });
  });

  it("returns the same score across timeline filters and pages", async () => {
    mocks.counts.mockResolvedValue([
      { action: "USER_PAYOUT_DESTINATION_VERIFIED", _count: { _all: 2 } },
      { action: "USER_PAYOUT_LOOKUP_MISMATCH", _count: { _all: 3 } },
    ]);
    const all = await request(app).get("/owners/44/account-activity").expect(200);
    const filtered = await request(app).get("/owners/44/account-activity").query({ category: "security", before: "71" }).expect(200);
    expect(all.body.behaviour).toMatchObject({ days: 30, score: 60, band: "ACTION" });
    expect(filtered.body.behaviour).toEqual(all.body.behaviour);
    const [first, second] = mocks.counts.mock.calls.map(([query]) => query.where.AND);
    expect(second[0]).toEqual({ ...first[0], createdAt: { gte: expect.any(Date) } });
    expect(second[1]).toEqual(first[1]);
    expect(mocks.counts.mock.calls[0][0].where.AND[1].OR).toEqual(expect.arrayContaining([
      { action: "USER_PAYOUT_DESTINATION_VERIFIED", afterJson: { path: "$.change", equals: "changed" } },
      { action: "USER_LOGIN", afterJson: { path: "$.success", equals: false } },
    ]));
  });

  it("keeps missing coverage distinct from a clean score and caps deductions at 100", () => {
    expect(ownerBehaviourScore(new Map(), true, false)).toMatchObject({ score: null, band: "NO_DATA" });
    expect(ownerBehaviourScore(new Map(), true, true)).toMatchObject({ score: 100, band: "CLEAN" });
    expect(ownerBehaviourScore(new Map([["USER_LOGIN", 5]]), false, true)).toMatchObject({ score: 80, band: "WATCH" });
    expect(ownerBehaviourScore(new Map([
      ["USER_PAYOUT_DESTINATION_VERIFIED", 4], ["USER_PAYOUT_LOOKUP_MISMATCH", 3], ["USER_LOGIN", 15], ["ACCOUNT_PASSWORD_RESET", 4],
    ]), false, true)).toMatchObject({ score: 0, band: "ACTION" });
  });

  it("pages filtered activity in batches of 25 and bounds out-of-range pages", async () => {
    mocks.total.mockResolvedValue(57);
    const result = await request(app).get("/owners/44/account-activity").query({ category: "payout", page: 2 }).expect(200);
    expect(result.body.pagination).toEqual({ page: 2, pageSize: 25, total: 57 });
    const where = mocks.total.mock.calls[0][0].where;
    expect(where.action.in).toContain("USER_PAYOUT_DESTINATION_VERIFIED");
    expect(where.action.in).not.toContain("USER_LOGIN");
    expect(mocks.logs).toHaveBeenLastCalledWith(expect.objectContaining({ where, skip: 25, take: 25 }));

    const last = await request(app).get("/owners/44/account-activity").query({ category: "payout", page: 999 }).expect(200);
    expect(last.body.pagination).toEqual({ page: 3, pageSize: 25, total: 57 });
    expect(mocks.logs).toHaveBeenLastCalledWith(expect.objectContaining({ where, skip: 50, take: 25 }));
    await request(app).get("/owners/44/account-activity").query({ page: 0 }).expect(400);
    await request(app).get("/owners/44/account-activity").query({ page: 2, before: "71" }).expect(400);
  });
});

describe("private owner notes", () => {
  it("reads notes scoped to the owner, with the author and correct total", async () => {
    const note = { id: 7, text: "Owner requested a callback", createdAt, admin: { id: 7, name: "Admin", fullName: "Example Admin" } };
    mocks.owner.mockResolvedValue({ _count: { adminNotesReceived: 13 } });
    mocks.notes.mockResolvedValue([note]);
    const result = await request(app).get("/owners/44/notes").query({ page: 2 }).expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body).toMatchObject({ items: [{ ...note, createdAt: createdAt.toISOString() }], page: 2, pageSize: 10, total: 13 });
    expect(mocks.notes).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 44 }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, skip: 10,
    }));
    mocks.role = "OWNER";
    await request(app).get("/owners/44/notes").expect(403);
    await request(app).post("/owners/44/notes").send({ text: "Cannot write" }).expect(403);
  });

  it("saves sanitized text and records only the note reference in the general audit", async () => {
    mocks.saveNote.mockResolvedValue({ id: 71, text: "Follow up", createdAt, admin: { id: 7, name: "Admin", fullName: null } });
    const result = await request(app).post("/owners/44/notes").send({ text: "  <b>Follow up</b> " }).expect(200);
    expect(result.body).toMatchObject({ ok: true, note: { id: 71, text: "Follow up" } });
    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({ data: { ownerId: 44, adminId: 7, text: "Follow up" } }));
    expect(mocks.noteAudit).toHaveBeenCalledWith({ data: { adminId: 7, targetUserId: 44, action: "ADD_NOTE", details: { noteId: 71 } } });
    await request(app).post("/owners/44/notes").send({ text: "<b></b>" }).expect(400);
    await request(app).post("/owners/44/notes").send({ text: "a".repeat(2001) }).expect(400);
    mocks.owner.mockResolvedValue(null);
    await request(app).post("/owners/45/notes").send({ text: "Follow up" }).expect(404);
    expect(mocks.saveNote).toHaveBeenCalledOnce();
  });
});
