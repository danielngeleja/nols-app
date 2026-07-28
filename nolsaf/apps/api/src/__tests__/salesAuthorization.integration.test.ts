import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => {
  const accessByUser = new Map<number, { status: string; expiresAt: Date | null }>();
  const profileFindUnique = vi.fn();
  const accessFindUnique = vi.fn();
  const leadFindFirst = vi.fn();
  const commissionFindFirst = vi.fn();
  const payoutFindFirst = vi.fn();
  const propertyFindFirst = vi.fn();
  const contractFindFirst = vi.fn();
  const commissionAggregate = vi.fn();

  const db: any = {};
  Object.assign(db, {
    salesPartnerProfile: { findUnique: profileFindUnique },
    userWorkspaceAccess: { findUnique: accessFindUnique },
    salesLead: { findFirst: leadFindFirst },
    salesCommission: {
      findFirst: commissionFindFirst,
      aggregate: commissionAggregate,
    },
    salesPayoutRequest: { findFirst: payoutFindFirst },
    property: { findFirst: propertyFindFirst },
    salesPartnerContract: { findFirst: contractFindFirst },
    $transaction: vi.fn(async (operation: (tx: any) => unknown) => operation(db)),
  });

  return {
    accessByUser,
    db,
    profileFindUnique,
    accessFindUnique,
    leadFindFirst,
    commissionFindFirst,
    payoutFindFirst,
    propertyFindFirst,
    contractFindFirst,
    commissionAggregate,
  };
});

vi.mock("@nolsaf/prisma", () => ({
  prisma: security.db,
  typedPrisma: security.db,
}));

vi.mock("../middleware/auth.js", () => {
  const requireAuth = (req: any, res: any, next: any) => {
    const userId = Number(req.get("x-test-user-id"));
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = {
      id: userId,
      role: req.get("x-test-role") || "USER",
      imp: req.get("x-test-impersonated") === "true",
    };
    return next();
  };
  const blockImpersonated = (req: any, res: any, next: any) => {
    if (req.user?.imp) {
      return res.status(403).json({
        error: "This action is not available during an admin support session",
        code: "IMPERSONATION_FORBIDDEN",
      });
    }
    return next();
  };
  return { requireAuth, blockImpersonated };
});

vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    limitSalesContractAccept: pass,
    limitSalesContractRead: pass,
    limitSalesLeadRead: pass,
    limitSalesLeadWrite: pass,
    limitSalesPropertyRead: pass,
    limitSalesAdminWrite: pass,
  };
});

const PARTNER_A_USER_ID = 101;
const PARTNER_A_ID = 11;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CONTRACT = {
  id: 701,
  status: "ACTIVE",
  startsAt: new Date(Date.now() - DAY_MS),
  expiresAt: new Date(Date.now() + 365 * DAY_MS),
  nrmsCommissionRate: 14,
  marketplaceRevenueRate: 20,
};

function asPartnerA(target: request.Test) {
  return target.set("x-test-user-id", String(PARTNER_A_USER_ID));
}

function assertPartnerScope(where: any, objectId: number, idField = "id") {
  expect(where).toMatchObject({
    [idField]: objectId,
    salesPartnerId: PARTNER_A_ID,
  });
  return null;
}

let app: express.Express;

beforeAll(async () => {
  const [
    { default: leadsRouter },
    { default: propertiesRouter },
    { default: earningsRouter },
    { default: payoutsRouter },
    { default: contractsRouter },
  ] = await Promise.all([
    import("../routes/sales.leads.js"),
    import("../routes/sales.properties.js"),
    import("../routes/sales.earnings.js"),
    import("../routes/sales.payouts.js"),
    import("../routes/sales.contracts.js"),
  ]);

  app = express();
  app.use(express.json());
  app.use("/api/sales", contractsRouter);
  app.use("/api/sales", leadsRouter);
  app.use("/api/sales", propertiesRouter);
  app.use("/api/sales", earningsRouter);
  app.use("/api/sales", payoutsRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "test error" });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  security.accessByUser.clear();
  security.accessByUser.set(PARTNER_A_USER_ID, {
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 365 * DAY_MS),
  });

  security.profileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where.userId !== PARTNER_A_USER_ID) return null;
    return {
      id: PARTNER_A_ID,
      agentCode: "NSA-DAR-0101",
      status: "ACTIVE",
      level: "STARTER",
      region: "Dar es Salaam",
      territory: "Dar es Salaam",
      contracts: [ACTIVE_CONTRACT],
      user: {
        id: PARTNER_A_USER_ID,
        name: "Partner A",
        fullName: "Partner Alpha",
        address: "Dar es Salaam",
        nin: "TEST-A",
      },
    };
  });
  security.accessFindUnique.mockImplementation(async ({ where }: any) => {
    return security.accessByUser.get(where.userId_workspace.userId) ?? null;
  });
  security.leadFindFirst.mockImplementation(async ({ where }: any) => {
    return assertPartnerScope(where, 9001);
  });
  security.commissionFindFirst.mockImplementation(async ({ where }: any) => {
    return assertPartnerScope(where, 9002);
  });
  security.payoutFindFirst.mockImplementation(async ({ where }: any) => {
    return assertPartnerScope(where, 9003);
  });
  security.propertyFindFirst.mockImplementation(async ({ where }: any) => {
    expect(where.id).toBe(9004);
    expect(where.salesAttributions?.some?.salesPartnerId).toBe(PARTNER_A_ID);
    return null;
  });
  security.contractFindFirst.mockImplementation(async ({ where }: any) => {
    return assertPartnerScope(where, 9005);
  });
  security.commissionAggregate.mockResolvedValue({
    _sum: { commissionAmount: 0, eligibleNetRevenue: 0 },
    _count: { id: 0 },
  });
});

describe("sales workspace object-level authorization", () => {
  it("does not disclose Partner B records when Partner A forges object IDs", async () => {
    const responses = await Promise.all([
      asPartnerA(request(app).get("/api/sales/leads/9001")),
      asPartnerA(request(app).get("/api/sales/earnings/9002")),
      asPartnerA(request(app).get("/api/sales/payouts/9003")),
      asPartnerA(request(app).get("/api/sales/properties/9004")),
      asPartnerA(request(app).get("/api/sales/contracts/9005")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
    expect(responses.map((response) => response.body.error)).toEqual([
      "Lead not found",
      "Earning not found",
      "Payout request not found",
      "Attributed property not found",
      "Contract not found",
    ]);
  });

  it("does not modify Partner B records when Partner A forges write IDs", async () => {
    const [lead, payout, contract] = await Promise.all([
      asPartnerA(request(app).patch("/api/sales/leads/9001")).send({ status: "CONTACTED" }),
      asPartnerA(request(app).post("/api/sales/payouts/9003/cancel")).send({
        reason: "Requested by the wrong partner",
      }),
      asPartnerA(request(app).post("/api/sales/contracts/9005/view")).send({}),
    ]);

    expect([lead.status, payout.status, contract.status]).toEqual([404, 404, 404]);
    expect(security.db.salesLead).not.toHaveProperty("update");
    expect(security.db.salesPartnerContract).not.toHaveProperty("updateMany");
  });
});

describe("sales workspace entitlement enforcement", () => {
  for (const status of ["PENDING", "SUSPENDED", "REVOKED"]) {
    it(`rejects a ${status} workspace before querying partner records`, async () => {
      security.accessByUser.set(PARTNER_A_USER_ID, {
        status,
        expiresAt: new Date(Date.now() + 365 * DAY_MS),
      });

      const response = await asPartnerA(request(app).get("/api/sales/leads/9001"));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Sales workspace access required");
      expect(security.leadFindFirst).not.toHaveBeenCalled();
    });
  }

  it("rejects an expired ACTIVE workspace before querying partner records", async () => {
    security.accessByUser.set(PARTNER_A_USER_ID, {
      status: "ACTIVE",
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const response = await asPartnerA(request(app).get("/api/sales/leads/9001"));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Sales workspace access required");
    expect(security.leadFindFirst).not.toHaveBeenCalled();
  });
});

describe("sales workspace impersonation restrictions", () => {
  it("blocks an impersonated support session from changing leads, payouts, or contracts", async () => {
    const impersonated = (target: request.Test) =>
      asPartnerA(target).set("x-test-impersonated", "true");

    const [lead, payout, contract] = await Promise.all([
      impersonated(request(app).patch("/api/sales/leads/9001")).send({ status: "CONTACTED" }),
      impersonated(request(app).post("/api/sales/payouts/9003/cancel")).send({
        reason: "Support session must not cancel",
      }),
      impersonated(request(app).post("/api/sales/contracts/9005/accept")).send({
        acceptedName: "Partner Alpha",
        expectedTermsHash: "a".repeat(64),
        confirmAuthority: true,
        confirmIndependentContractor: true,
        confirmMarketplaceExample: true,
      }),
    ]);

    for (const response of [lead, payout, contract]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("IMPERSONATION_FORBIDDEN");
    }
    expect(security.leadFindFirst).not.toHaveBeenCalled();
    expect(security.payoutFindFirst).not.toHaveBeenCalled();
    expect(security.contractFindFirst).not.toHaveBeenCalled();
  });
});
