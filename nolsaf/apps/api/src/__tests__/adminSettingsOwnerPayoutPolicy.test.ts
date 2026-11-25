import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  auditCreate: vi.fn(),
  financeGrant: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: m.findUnique, upsert: m.upsert, create: vi.fn() },
    auditLog: { create: m.auditCreate, findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 1, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/financeGrantStore.js", () => ({ hasFinanceGrant: m.financeGrant }));
vi.mock("../lib/securitySettings.js", () => ({ invalidateSessionPolicyCache: vi.fn() }));
vi.mock("../middleware/socketAuth.js", () => ({ enforceSocketSessionPolicy: vi.fn() }));

import { router } from "../routes/admin.settings.js";

const BEFORE = {
  id: 1,
  ownerFirstPayoutAutoMaxTzs: null,
  ownerWithdrawalReviewAlertHours: 4,
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/settings", router);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every column probe succeeds (migration applied) and the full-row read returns BEFORE.
  m.findUnique.mockResolvedValue(BEFORE);
  m.upsert.mockImplementation(async ({ update }: any) => ({ ...BEFORE, ...update }));
  m.auditCreate.mockResolvedValue({});
  m.financeGrant.mockResolvedValue(true);
});

describe("owner first-payout policy in Settings", () => {
  it("returns the stored values, the code ceiling and that they can be saved", async () => {
    m.findUnique.mockResolvedValue({ ...BEFORE, ownerFirstPayoutAutoMaxTzs: 1_000_000, ownerWithdrawalReviewAlertHours: 6 });
    const res = await request(app()).get("/settings");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ownerFirstPayoutAutoMaxTzs: 1_000_000,
      ownerWithdrawalReviewAlertHours: 6,
      ownerFirstPayoutAutoCeilingTzs: 2_000_000,
      ownerPayoutPolicyAvailable: true,
    });
  });

  it("refuses a first-payout limit above the 2,000,000 ceiling", async () => {
    const res = await request(app()).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: 2_000_001 });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([expect.objectContaining({ field: "ownerFirstPayoutAutoMaxTzs" })]);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("needs the finance code to turn the automatic first payout on", async () => {
    m.financeGrant.mockResolvedValue(false);
    const res = await request(app()).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: 500_000 });
    expect(res.status).toBe(403);
    expect(res.body.require2fa).toBe(true);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("saves it with the finance code and records the change in the audit log", async () => {
    const res = await request(app()).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: 500_000 });
    expect(res.status).toBe(200);
    expect(m.upsert.mock.calls[0][0].update).toMatchObject({ ownerFirstPayoutAutoMaxTzs: 500_000 });
    expect(m.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "ADMIN_SETTINGS_UPDATE",
        afterJson: { changes: { ownerFirstPayoutAutoMaxTzs: { from: null, to: 500_000 } } },
      }),
    }));
  });

  it("lets anyone tighten it (lower or blank) without the finance code", async () => {
    m.financeGrant.mockResolvedValue(false);
    m.findUnique.mockResolvedValue({ ...BEFORE, ownerFirstPayoutAutoMaxTzs: 1_000_000 });
    const lower = await request(app()).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: 300_000 });
    expect(lower.status).toBe(200);
    const off = await request(app()).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: "" });
    expect(off.status).toBe(200);
    expect(m.upsert.mock.calls[1][0].update.ownerFirstPayoutAutoMaxTzs).toBeNull();
  });

  it("keeps the alert hours between 1 and 24", async () => {
    for (const bad of [0, 25]) {
      const res = await request(app()).put("/settings").send({ ownerWithdrawalReviewAlertHours: bad });
      expect(res.status).toBe(400);
    }
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("needs the finance code to alert later, not to alert sooner", async () => {
    m.financeGrant.mockResolvedValue(false);
    expect((await request(app()).put("/settings").send({ ownerWithdrawalReviewAlertHours: 8 })).status).toBe(403);
    expect((await request(app()).put("/settings").send({ ownerWithdrawalReviewAlertHours: 2 })).status).toBe(200);
  });

  it("before the migration, ignores the fields instead of blocking every settings save", async () => {
    m.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.ownerFirstPayoutAutoMaxTzs) throw Object.assign(new Error("Unknown field"), { code: "P2022" });
      return { id: 1 };
    });
    // The route caches "columns exist" once seen; a fresh copy has not seen them.
    vi.resetModules();
    const fresh = (await import("../routes/admin.settings.js")).router;
    const a = express();
    a.use(express.json());
    a.use("/settings", fresh);
    const res = await request(a).put("/settings").send({ ownerFirstPayoutAutoMaxTzs: 500_000, ownerWithdrawalReviewAlertHours: 4 });
    expect(res.status).toBe(200);
    expect(m.upsert.mock.calls[0][0].update).not.toHaveProperty("ownerFirstPayoutAutoMaxTzs");
    expect(m.upsert.mock.calls[0][0].update).not.toHaveProperty("ownerWithdrawalReviewAlertHours");
  });
});
