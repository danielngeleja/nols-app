import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, findUnique, updateMany, sessionFindFirst } = vi.hoisted(() => ({
  create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), sessionFindFirst: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    supportImpersonationHandoff: { create, findUnique, updateMany },
    session: { findFirst: sessionFindFirst },
  },
}));
vi.mock("./securitySettings.js", () => ({
  getRoleSessionMaxMinutes: vi.fn().mockResolvedValue(60),
  getSessionIdleMinutes: vi.fn().mockResolvedValue(30),
}));

describe("support impersonation handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: "handoff-1" });
    sessionFindFirst.mockResolvedValue({
      lastSeenAt: new Date(),
      user: { role: "ADMIN", suspendedAt: null, isDisabled: false, tokensValidAfter: null },
    });
  });

  it("stores a hash rather than the admin JWT and binds both sessions", async () => {
    const { createSupportHandoff } = await import("./supportImpersonation.js");
    const adminToken = jwt.sign({ sub: "7", sid: "admin-session", amr: "passkey" }, "test-secret", { expiresIn: 3600 });
    const supportToken = jwt.sign({ sub: "42", sid: "support-session", role: "OWNER", imp: true, act: 7 }, "test-secret", { expiresIn: 600 });
    const handle = await createSupportHandoff(adminToken, { id: 7, role: "ADMIN", sessionId: "admin-session" }, supportToken, "OWNER");
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ adminId: 7, adminSessionId: "admin-session", supportUserId: 42, supportSessionId: "support-session", supportRole: "OWNER", adminMfa: "passkey" });
    expect(data.handleHash).toBe(crypto.createHash("sha256").update(handle).digest("hex"));
    expect(JSON.stringify(data)).not.toContain(adminToken);
    expect(JSON.stringify(data)).not.toContain(supportToken);
  });

  it("rejects expired or consumed handles and consumes a valid handle once", async () => {
    const { consumeSupportHandoff, getActiveSupportHandoff } = await import("./supportImpersonation.js");
    const handle = "a".repeat(43);
    const row = {
      handleHash: "0".repeat(64), adminId: 7, adminSessionId: "admin-session",
      adminIssuedAt: Math.floor(Date.now() / 1000) - 30,
      adminExpiresAt: Math.floor(Date.now() / 1000) + 600,
      adminMfa: "passkey", supportUserId: 42, supportSessionId: "support-session",
      supportRole: "OWNER", expiresAt: new Date(Date.now() + 600_000), usedAt: null,
    };
    findUnique.mockResolvedValue(row);
    expect(await getActiveSupportHandoff(`nolsaf_support_handoff=${handle}`)).toBe(row);
    findUnique.mockResolvedValue({ ...row, usedAt: new Date() });
    expect(await getActiveSupportHandoff(`nolsaf_support_handoff=${handle}`)).toBeNull();
    findUnique.mockResolvedValue({ ...row, expiresAt: new Date(Date.now() - 1) });
    expect(await getActiveSupportHandoff(`nolsaf_support_handoff=${handle}`)).toBeNull();
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await consumeSupportHandoff(row.handleHash)).toBe(true);
    expect(await consumeSupportHandoff(row.handleHash)).toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ usedAt: null, expiresAt: { gt: expect.any(Date) } }) }));
  });

  it("cannot restore a different support session or admin actor", async () => {
    const { supportHandoffMatchesUser } = await import("./supportImpersonation.js");
    const handoff = { adminId: 7, supportUserId: 42, supportSessionId: "support-session", supportRole: "OWNER" };
    const user = { id: 42, role: "OWNER" as const, sessionId: "support-session", imp: true, impersonatorId: 7 };
    expect(supportHandoffMatchesUser(handoff, user)).toBe(true);
    expect(supportHandoffMatchesUser(handoff, { ...user, sessionId: "other-session" })).toBe(false);
    expect(supportHandoffMatchesUser(handoff, { ...user, impersonatorId: 8 })).toBe(false);
    expect(supportHandoffMatchesUser(handoff, undefined)).toBe(false);
  });
});
