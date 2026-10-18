import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adminRouter from "../routes/admin.appDistribution.js";
import publicRouter from "../routes/public.appDistribution.js";

const mocks = vi.hoisted(() => ({
  role: "ADMIN",
  row: null as any,
  audit: vi.fn(),
  transaction: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    appDistributionSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: mocks.role }; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => req.user.role === role ? next() : res.sendStatus(403),
}));
vi.mock("../lib/audit.js", () => ({ auditOrThrow: mocks.audit }));

const app = express();
app.use(express.json());
app.use("/api/admin/app-distribution", adminRouter);
app.use("/api/public/app-distribution", publicRouter);

const valid = {
  enabled: true,
  showOnHome: true,
  showInFooter: false,
  headline: "NoLSAF anywhere",
  description: "Plan every trip in the app.",
  androidEnabled: true,
  androidStoreUrl: "https://play.google.com/store/apps/details?id=com.nolsaf.app",
  iosEnabled: false,
  iosStoreUrl: null,
};

describe("app distribution routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "ADMIN";
    mocks.row = null;
    mocks.findUnique.mockImplementation(async () => mocks.row);
    mocks.upsert.mockImplementation(async ({ create, update }: any) => {
      mocks.row = { ...(mocks.row ? update : create), id: 1, updatedAt: new Date() };
      return mocks.row;
    });
    mocks.transaction.mockImplementation(async (callback: any) => callback({ appDistributionSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert }, auditLog: { create: vi.fn() } }));
    mocks.audit.mockResolvedValue(undefined);
  });

  it("lets an admin publish a verified listing and exposes only the active platform", async () => {
    const saved = await request(app).put("/api/admin/app-distribution").send(valid);
    expect(saved.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledOnce();
    const published = await request(app).get("/api/public/app-distribution");
    expect(published.status).toBe(200);
    expect(published.body.enabled).toBe(true);
    expect(published.body.androidStoreUrl).toBe(valid.androidStoreUrl);
    expect(published.body.iosStoreUrl).toBeNull();
    expect(published.body).not.toHaveProperty("updatedById");
    expect(published.headers["cache-control"]).toBe("no-store");
  });

  it("denies non-admin changes and leaves promotions hidden on database failure", async () => {
    mocks.role = "CUSTOMER";
    expect((await request(app).put("/api/admin/app-distribution").send(valid)).status).toBe(403);
    mocks.findUnique.mockRejectedValue(new Error("database offline"));
    const response = await request(app).get("/api/public/app-distribution");
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.androidStoreUrl).toBeNull();
  });
});
