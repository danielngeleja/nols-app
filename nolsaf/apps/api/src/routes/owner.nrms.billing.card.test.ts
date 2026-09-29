import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tokenFindFirst: vi.fn(),
  tokenUpdate: vi.fn(),
  accountUpdate: vi.fn(),
  eventUpsert: vi.fn(),
  transaction: vi.fn(),
  coralPost: vi.fn(),
  parseCoral: vi.fn(),
  idemSet: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => {
  const prisma: any = {
    nrmsServicePaymentToken: {
      findFirst: mocks.tokenFindFirst,
      update: mocks.tokenUpdate,
    },
    ownerPaygAccount: { update: mocks.accountUpdate },
    paymentEvent: { upsert: mocks.eventUpsert },
    $transaction: mocks.transaction,
  };
  return { prisma };
});

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "OWNER" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/nrms.js", () => ({
  requireNrms: (_req: any, _res: any, next: any) => next(),
  loadOwnedActiveNrmsProperty: vi.fn(),
}));

vi.mock("../lib/azampay.auth.js", () => ({
  getAzamPayToken: vi.fn(),
  invalidateAzamPayToken: vi.fn(),
}));

vi.mock("../lib/azampay.helpers.js", () => ({
  azampayMnoPost: vi.fn(),
  describeAzamPayResponseBody: vi.fn(),
  idemGet: vi.fn(async () => null),
  idemSet: mocks.idemSet,
  makePaymentRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  normalizePhone: vi.fn(),
  CHECKOUT_BANK_CODES: ["CRDB"],
}));

vi.mock("../lib/coralcommerce.helpers.js", () => ({
  coralPostJson64: mocks.coralPost,
  parseCoralInitiateResponse: mocks.parseCoral,
}));

vi.mock("../lib/serviceAvailability.js", () => ({
  getPaymentMethodAvailability: vi.fn(async () => ({ enabled: true })),
}));

vi.mock("../lib/nrmsBilling.js", () => ({
  markNrmsPaymentFailed: vi.fn(),
}));

let app: express.Express;
const token = "NRMS-1234567890ABCDEF1234567890ABCDEF1234";

beforeAll(async () => {
  process.env.CORAL_UCF_USERNAME = "test-user";
  process.env.CORAL_UCF_PASSWORD = "test-password";
  process.env.CORAL_UCF_ALIAS = "test-alias";
  process.env.CORAL_UCF_CALLBACK_URL = "https://api.example.test/callback";
  process.env.CORAL_UCF_POSTBACK_SUCCESS_URL = "https://web.example.test/return";
  process.env.CORAL_UCF_POSTBACK_FAILURE_URL = "https://web.example.test/return";
  const { default: router } = await import("./owner.nrms.billing.js");
  app = express();
  app.use(express.json());
  app.use("/api/owner/nrms/billing", router);
});

beforeEach(() => {
  vi.clearAllMocks();
  const row = {
    id: 41,
    token,
    amount: 50_000,
    currency: "TZS",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 86_400_000),
    payment: null,
    statementId: 9,
    statement: {
      id: 9,
      status: "PAYABLE",
      accountId: 12,
      account: {
        id: 12,
        propertyId: 1,
        owner: { name: "Owner", fullName: "Test Öwner", email: "owner@example.test", phone: "+255700000000" },
        property: { id: 1, title: "Test Hôtel · Zanzibar" },
      },
    },
  };
  mocks.tokenFindFirst.mockResolvedValue(row);
  mocks.tokenUpdate.mockResolvedValue(row);
  mocks.accountUpdate.mockResolvedValue({ id: 12 });
  mocks.transaction.mockImplementation(async (input: any) => (
    Array.isArray(input) ? Promise.all(input) : input({})
  ));
  mocks.coralPost.mockResolvedValue({ ok: true, status: 200, body: "{}" });
  mocks.parseCoral.mockReturnValue({
    code: "000",
    message: "Request processed successfully",
    redirectUrl: "https://secure.coralcommerce.test/Payserver/Hosted/Index?key=fresh",
  });
  mocks.idemSet.mockResolvedValue(undefined);
});

describe("NRMS Coral checkout latency boundary", () => {
  it("returns the hosted URL without waiting for post-Coral audit enrichment", async () => {
    mocks.eventUpsert
      .mockResolvedValueOnce({ id: 1 })
      .mockImplementationOnce(() => new Promise(() => undefined));

    const response = await request(app)
      .post(`/api/owner/nrms/billing/tokens/${token}/initiate`)
      .send({ channel: "CARD", idempotencyKey: "nrms-card-test-123" })
      .timeout({ response: 1_000, deadline: 2_000 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      paymentRef: token,
      checkoutUrl: "https://secure.coralcommerce.test/Payserver/Hosted/Index?key=fresh",
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.coralPost).toHaveBeenCalledTimes(1);
    const sent = mocks.coralPost.mock.calls[0][0].Transaction;
    expect(sent.Order.Products[0]).toMatchObject({
      Code: "NRMS",
      Description: "NoLSAF NRMS usage charges - Statement #9",
      Price: 50_000,
      SubTotal: 50_000,
    });
    expect(sent.UCF).toMatchObject({
      CustomerFullName: "NoLSAF Owner",
      CustomerEmail: "",
      CustomerMobile: "",
      CallbackUrl: "https://api.example.test/callback",
    });
    expect(sent.Identifier).toBe(token);
    expect(sent.Submission.Stamp).toBe(response.body.transactionId);
    expect(mocks.eventUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.coralPost.mock.invocationCallOrder[0]);
  });
});

describe("NRMS billing receipt PDF", () => {
  it("only downloads a receipt for a verified paid statement", async () => {
    const pending = await request(app).get(`/api/owner/nrms/billing/tokens/${token}/receipt.pdf`);
    expect(pending.status).toBe(409);

    const paidRow = {
      id: 41,
      token,
      method: "CARD",
      status: "PAID",
      statementId: 1098,
      statement: {
        status: "PAID",
        paidAt: new Date("2026-09-29T14:38:00.000Z"),
        account: { property: { title: "Namibia Villa" } },
      },
      payment: {
        id: 10,
        status: "VERIFIED",
        provider: "CORALCOMMERCE",
        providerRef: "10292000000000024709",
        verifiedAt: new Date("2026-09-29T14:38:00.000Z"),
        amount: 10_000,
        currency: "TZS",
      },
    };
    mocks.tokenFindFirst.mockResolvedValue(paidRow);
    const response = await request(app).get(`/api/owner/nrms/billing/tokens/${token}/receipt.pdf`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toContain("NRMS-RCPT-10.pdf");
    expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
