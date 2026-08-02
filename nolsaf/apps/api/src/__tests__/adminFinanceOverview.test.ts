import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const finance = vi.hoisted(() => {
  const emptyAggregate = { _sum: {}, _count: { _all: 0 } };
  const state = { transportScenario: false };
  const transportAggregate = vi.fn(async (args: any) => {
    if (!state.transportScenario) return emptyAggregate;
    if (args?.where?.booking?.paymentStatus === "PAID") {
      return {
        _sum: { grossAmount: 667000, commissionAmount: 66700 },
        _count: { _all: 6 },
      };
    }
    if (args?.where?.status === "PAID") {
      return { _sum: { netPaid: 126000 }, _count: { _all: 1 } };
    }
    return emptyAggregate;
  });
  const subscriptionGroupBy = vi.fn(async (args: any) => {
    const statuses = args?.where?.status?.in;
    if (Array.isArray(statuses) && statuses.includes("VERIFIED") && statuses.includes("MANUALLY_VERIFIED")) {
      return [{ currency: "TZS", _sum: { amount: 18500 }, _count: { _all: 2 } }];
    }
    return [];
  });

  return {
    state,
    subscriptionGroupBy,
    transportAggregate,
    prisma: {
      invoice: { aggregate: vi.fn(async () => emptyAggregate) },
      tourBooking: { groupBy: vi.fn(async () => []) },
      transportPayout: { aggregate: transportAggregate },
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

beforeEach(() => {
  finance.state.transportScenario = false;
  finance.transportAggregate.mockClear();
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

describe("admin finance overview transport", () => {
  it("recognizes customer paid commission while counting only completed driver payouts as partner payments", async () => {
    finance.state.transportScenario = true;

    const response = await request(app).get("/api/admin/finance/overview").expect(200);
    const transport = response.body.streams.find((stream: any) => stream.key === "transport");

    expect(transport).toMatchObject({
      gmv: 667000,
      nolsafRevenue: 66700,
      partnerNet: 126000,
      realizedCount: 6,
      pendingRevenue: 0,
      pendingCount: 0,
    });
    expect(finance.transportAggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { booking: { paymentStatus: "PAID" } },
    }));
    expect(finance.transportAggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PAID" },
      _sum: { netPaid: true },
    }));
  });
});
