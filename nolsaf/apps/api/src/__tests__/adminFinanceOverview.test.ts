import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const finance = vi.hoisted(() => {
  const emptyAggregate = { _sum: {}, _count: { _all: 0 } };
  const subscriptionGroupBy = vi.fn(async (args: any) => {
    const statuses = args?.where?.status?.in;
    if (Array.isArray(statuses) && statuses.includes("VERIFIED") && statuses.includes("MANUALLY_VERIFIED")) {
      return [{ currency: "TZS", _sum: { amount: 18500 }, _count: { _all: 2 } }];
    }
    return [];
  });

  return {
    subscriptionGroupBy,
    prisma: {
      invoice: { aggregate: vi.fn(async () => emptyAggregate) },
      tourBooking: { groupBy: vi.fn(async () => []) },
      transportPayout: { aggregate: vi.fn(async () => emptyAggregate) },
      groupBooking: { aggregate: vi.fn(async () => emptyAggregate) },
      nrmsServicePayment: { groupBy: subscriptionGroupBy },
      nrmsBillingStatement: { groupBy: vi.fn(async () => []) },
    },
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: finance.prisma }));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/fx.js", () => ({
  BASE_CURRENCY: "TZS",
  getFxRates: vi.fn(async () => ({ tzsPerUnit: {} })),
}));

let app: express.Express;

beforeAll(async () => {
  const { default: router } = await import("../routes/admin.financeOverview.js");
  app = express();
  app.use("/api/admin/finance", router);
});

describe("admin finance overview subscriptions", () => {
  it("counts provider verified and manually reconciled NRMS payments as realized revenue", async () => {
    const response = await request(app).get("/api/admin/finance/overview").expect(200);

    expect(finance.subscriptionGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] },
      },
    }));

    const subscriptions = response.body.streams.find((stream: any) => stream.key === "subscriptions");
    expect(subscriptions).toMatchObject({
      gmv: 18500,
      nolsafRevenue: 18500,
      realizedCount: 2,
    });
    expect(response.body.totals).toMatchObject({
      gmv: 18500,
      nolsafRevenue: 18500,
      realizedCount: 2,
    });
  });
});
