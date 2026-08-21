import { describe, expect, it, vi } from "vitest";

vi.mock("./crypto.js", () => ({ hashPassword: vi.fn(async (_p: string) => "HASHED") }));

import { activateAgentFromInvite, inviteAgentUser, inviteAgentUserInTransaction, signAgentInviteToken, verifyAgentInviteToken } from "./nrmsAgentInvite.js";

function makeDb(over: Record<string, any> = {}) {
  const db: any = {
    user: {
      findUnique: vi.fn(async (_a: any) => null),
      create: vi.fn(async (_a: any) => ({ id: 55 })),
      update: vi.fn(async (_a: any) => ({})),
      updateMany: vi.fn(async (_a: any) => ({ count: 1 })),
    },
    nrmsAgentAccount: {
      create: vi.fn(async (_a: any) => ({ id: 77 })),
      findFirst: vi.fn(async (_a: any) => ({ id: 77 })),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    ...over,
  };
  return db;
}

describe("invite token", () => {
  it("round-trips a valid token", () => {
    const t = signAgentInviteToken(55, 77);
    expect(verifyAgentInviteToken(t)).toEqual({ typ: "AGENT_INVITE", userId: 55, accountId: 77 });
  });
  it("rejects garbage and foreign tokens", () => {
    expect(verifyAgentInviteToken("nope")).toBeNull();
    expect(verifyAgentInviteToken("")).toBeNull();
  });
});

describe("inviteAgentUser", () => {
  it("rejects an email already in use", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: 1 })), create: vi.fn(), update: vi.fn() } });
    const res = await inviteAgentUser(db, { email: "a@b.co", legalName: "Kili Travel" });
    expect(res).toMatchObject({ ok: false, reason: "EMAIL_IN_USE" });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("creates a password-less NRMS_AGENT user + agency and mints a token", async () => {
    const db = makeDb();
    const res = await inviteAgentUser(db, { email: "Info@Kili.CO", legalName: "Kili Travel", contactName: "Asha" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ userId: 55, accountId: 77 });
    const userData = db.user.create.mock.calls[0]![0].data;
    expect(userData).toMatchObject({ role: "NRMS_AGENT", email: "info@kili.co", passwordHash: null, fullName: "Asha" });
    expect(verifyAgentInviteToken(res.token)).toMatchObject({ userId: 55, accountId: 77 });
  });

  it("can join a caller-owned transaction without opening a nested transaction", async () => {
    const db = makeDb();
    const res = await inviteAgentUserInTransaction(db, { email: "atomic@kili.co", legalName: "Atomic Travel" });
    expect(res).toMatchObject({ ok: true, userId: 55, accountId: 77 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.create).toHaveBeenCalledTimes(1);
    expect(db.nrmsAgentAccount.create).toHaveBeenCalledTimes(1);
  });
});

describe("activateAgentFromInvite", () => {
  it("rejects an invalid token", async () => {
    const db = makeDb();
    expect(await activateAgentFromInvite(db, { token: "bad", password: "secret123" })).toMatchObject({ ok: false, reason: "INVALID_TOKEN" });
  });

  it("rejects when the agency binding is missing", async () => {
    const db = makeDb({ nrmsAgentAccount: { findFirst: vi.fn(async () => null), create: vi.fn() } });
    const token = signAgentInviteToken(55, 77);
    expect(await activateAgentFromInvite(db, { token, password: "secret1234567890" })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects a non-agent or missing user", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: 55, role: "CUSTOMER", passwordHash: null })), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() } });
    const token = signAgentInviteToken(55, 77);
    expect(await activateAgentFromInvite(db, { token, password: "secret1234567890" })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });

  it("refuses to re-activate a user that already has a password", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: 55, role: "NRMS_AGENT", email: "a@b.co", passwordHash: "EXISTING" })), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() } });
    const token = signAgentInviteToken(55, 77);
    expect(await activateAgentFromInvite(db, { token, password: "secret1234567890" })).toMatchObject({ ok: false, reason: "ALREADY_ACTIVE" });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("sets the password and verifies email on the happy path", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: 55, role: "NRMS_AGENT", email: "a@b.co", passwordHash: null })), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
    const token = signAgentInviteToken(55, 77);
    const res = await activateAgentFromInvite(db, { token, password: "secret1234567890" });
    expect(res).toMatchObject({ ok: true, userId: 55, role: "NRMS_AGENT" });
    const data = db.user.updateMany.mock.calls[0]![0].data;
    expect(data.passwordHash).toBe("HASHED");
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("allows only one concurrent redemption to win", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: 55, role: "NRMS_AGENT", email: "a@b.co", passwordHash: null })), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) } });
    const token = signAgentInviteToken(55, 77);
    expect(await activateAgentFromInvite(db, { token, password: "secret1234567890" })).toMatchObject({ ok: false, reason: "ALREADY_ACTIVE" });
  });
});
