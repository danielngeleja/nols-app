import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: { $queryRaw: database.query } }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/fx.js", () => ({
  BASE_CURRENCY: "TZS",
  getFxRates: vi.fn(async () => ({ tzsPerUnit: { TZS: 1, USD: 2500 } })),
}));

let app: express.Express;

beforeAll(async () => {
  const { default: router } = await import("../routes/admin.revenue.js");
  app = express();
  app.use("/api/admin/revenue", router);
});

beforeEach(() => {
  database.query.mockReset();
});

describe("admin home revenue classification", () => {
  it("shows verified NRMS billing as subscription without changing invoice commission, including NRMS-only properties", async () => {
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM invoice i")) return [{ id: 1, name: "Mixed hotel", commission_total: 4000 }];
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { id: 1, name: "Mixed hotel", currency: "TZS", subscription_total: 10000 },
        { id: 2, name: "NRMS-only hotel", currency: "USD", subscription_total: 2 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/properties?top=2").expect(200);
    expect(response.body).toEqual([
      { id: 1, name: "Mixed hotel", total: 14000, commission: 4000, subscription: 10000 },
      { id: 2, name: "NRMS-only hotel", total: 5000, commission: 0, subscription: 5000 },
    ]);

    const subscriptionSql = database.query.mock.calls.map((call) => call[0].join("?")).find((sql) => sql.includes("FROM nrms_service_payment pay"));
    expect(subscriptionSql).toContain("pay.status IN ('VERIFIED', 'MANUALLY_VERIFIED')");
    expect(subscriptionSql).toContain("statement.id = token.statementId");
    expect(subscriptionSql).toContain("account.id = statement.accountId");
  });

  it("places NRMS-only verified payments in the subscription time series by verification date", async () => {
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM invoice i")) return [{ label: "2026-09-29", commission_total: 4000 }];
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { label: "2026-09-29", currency: "TZS", subscription_total: 10000 },
        { label: "2026-09-30", currency: "TZS", subscription_total: 2000 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/series?from=2026-09-29&to=2026-10-01&interval=day").expect(200);
    expect(response.body).toEqual([
      { label: "2026-09-29", commission: 4000, subscription: 10000 },
      { label: "2026-09-30", commission: 0, subscription: 2000 },
    ]);

    const subscriptionSql = database.query.mock.calls.map((call) => call[0].join("?")).find((sql) => sql.includes("FROM nrms_service_payment pay"));
    expect(subscriptionSql).toContain("pay.verifiedAt BETWEEN");
    expect(subscriptionSql).toContain("pay.status IN ('VERIFIED', 'MANUALLY_VERIFIED')");
  });

  it("includes verified NRMS billing in the today/yesterday platform revenue total", async () => {
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM invoice i")) return [{ today_total: 4000, yesterday_total: 1000 }];
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { currency: "TZS", today_total: 10000, yesterday_total: 0 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/summary").expect(200);
    expect(response.body).toMatchObject({ today: 14000, yesterday: 1000 });
  });
});
