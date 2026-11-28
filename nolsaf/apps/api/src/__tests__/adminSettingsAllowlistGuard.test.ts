import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: mocks.settingFindUnique, upsert: mocks.settingUpsert },
    auditLog: { create: mocks.auditCreate, findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: "ADMIN" };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/socketAuth.js", () => ({ enforceSocketSessionPolicy: vi.fn() }));
vi.mock("../lib/securitySettings.js", () => ({ invalidateSessionPolicyCache: vi.fn() }));
vi.mock("../lib/financeGrantStore.js", () => ({ hasFinanceGrant: vi.fn().mockResolvedValue(true) }));
vi.mock("../lib/securityAlerts.js", () => ({ raiseSecurityAlert: vi.fn() }));

import { router } from "../routes/admin.settings";

const MY_IP = "203.0.113.7";

function app() {
  const a = express();
  a.set("trust proxy", 1);
  a.use(express.json());
  a.use("/api/admin/settings", router);
  return a;
}

describe("admin settings: allowlist lockout guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingFindUnique.mockResolvedValue({ id: 1, enableIpAllowlist: true, ipAllowlist: MY_IP });
    mocks.settingUpsert.mockImplementation(async ({ update }: any) => ({ id: 1, ...update }));
    mocks.auditCreate.mockResolvedValue({});
  });

  it("refuses a list that leaves out the admin's own address while enforcement is on", async () => {
    const res = await request(app())
      .put("/api/admin/settings")
      .set("X-Forwarded-For", MY_IP)
      .send({ ipAllowlist: "198.51.100.0/24" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALLOWLIST_EXCLUDES_YOU");
    expect(res.body.ip).toBe(MY_IP);
    expect(res.body.details[0].field).toBe("ipAllowlist");
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("refuses turning enforcement on over a saved list that leaves the admin out", async () => {
    mocks.settingFindUnique.mockResolvedValue({ id: 1, enableIpAllowlist: false, ipAllowlist: "198.51.100.0/24" });
    const res = await request(app())
      .put("/api/admin/settings")
      .set("X-Forwarded-For", MY_IP)
      .send({ enableIpAllowlist: true });
    expect(res.status).toBe(409);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("saves a list that includes the admin's address", async () => {
    const res = await request(app())
      .put("/api/admin/settings")
      .set("X-Forwarded-For", MY_IP)
      .send({ ipAllowlist: `198.51.100.0/24\n${MY_IP}` });
    expect(res.status).toBe(200);
    expect(mocks.settingUpsert).toHaveBeenCalled();
  });

  it("allows any list while enforcement stays off, and allows clearing it", async () => {
    mocks.settingFindUnique.mockResolvedValue({ id: 1, enableIpAllowlist: false, ipAllowlist: null });
    const off = await request(app()).put("/api/admin/settings").set("X-Forwarded-For", MY_IP).send({ ipAllowlist: "198.51.100.0/24" });
    expect(off.status).toBe(200);

    mocks.settingFindUnique.mockResolvedValue({ id: 1, enableIpAllowlist: true, ipAllowlist: MY_IP });
    const cleared = await request(app()).put("/api/admin/settings").set("X-Forwarded-For", MY_IP).send({ ipAllowlist: "" });
    expect(cleared.status).toBe(200);
  });

  it("reports the address the allowlist sees", async () => {
    const res = await request(app()).get("/api/admin/settings/my-ip").set("X-Forwarded-For", MY_IP);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ip: MY_IP, switchOn: true, enforced: true, listed: true });
  });
});
