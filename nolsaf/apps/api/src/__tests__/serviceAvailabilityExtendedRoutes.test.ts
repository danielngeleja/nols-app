import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  azampayToken: vi.fn(),
  azampayPost: vi.fn(),
  coralPost: vi.fn(),
  nrmsTokenFindFirst: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsServicePaymentToken: { findFirst: mocks.nrmsTokenFindFirst },
  },
}));

vi.mock("../lib/serviceAvailability.js", () => ({
  getPaymentMethodAvailability: mocks.gate,
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 71, role: "OWNER" };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/nrms.js", () => ({
  requireNrms: (_req: any, _res: any, next: any) => next(),
  loadOwnedActiveNrmsProperty: vi.fn(),
}));

vi.mock("../middleware/rateLimit.js", () => ({
  limitPlanRequestMessages: (_req: any, _res: any, next: any) => next(),
  limitPublicTourBookingCreate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/redisRateLimitStore.js", () => ({
  rateLimitWithRedis: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../lib/notifications.js", () => ({
  notifyAdmins: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("../lib/azampay.auth.js", () => ({
  getAzamPayToken: mocks.azampayToken,
  invalidateAzamPayToken: vi.fn(),
}));

vi.mock("../lib/azampay.helpers.js", () => ({
  AZAMPAY_API_URL: "https://example.invalid",
  FETCH_TIMEOUT_MS: 10_000,
  TZ_PHONE_RE: /^(\+255|0)(6|7|2)\d{8}$/,
  normalizePhone: vi.fn((value: string) => value),
  maskAzamPayPhone: vi.fn(() => "***"),
  describeAzamPayResponseBody: vi.fn(() => ({})),
  azampayPost: mocks.azampayPost,
  azampayMnoPost: mocks.azampayPost,
  idemGet: vi.fn(async () => null),
  idemSet: vi.fn(async () => undefined),
  makePaymentRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  CHECKOUT_BANK_CODES: ["CRDB", "NMB"],
  SUPPORTED_BANK_CODES: ["CRDB", "NMB"],
}));

vi.mock("../lib/coralcommerce.helpers.js", () => ({
  CORAL_UCF_API_URL: "https://example.invalid",
  coralPostJson64: mocks.coralPost,
  parseCoralInitiateResponse: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(() => "signed-token"),
    verify: vi.fn(() => ({ typ: "TOUR_BOOKING_ACCESS", tourBookingId: 42 })),
  },
}));

let groupApp: express.Express;
let tourApp: express.Express;
let nrmsApp: express.Express;

beforeAll(async () => {
  const [{ default: groupRouter }, { default: tourRouter }, { default: nrmsRouter }] = await Promise.all([
    import("../routes/customer.groupStays.js"),
    import("../routes/public.tourBookings.js"),
    import("../routes/owner.nrms.billing.js"),
  ]);

  groupApp = express();
  groupApp.use(express.json());
  groupApp.use("/api/customer/group-stays", groupRouter);

  tourApp = express();
  tourApp.use(express.json());
  tourApp.use("/api/public/tour-bookings", tourRouter);

  nrmsApp = express();
  nrmsApp.use(express.json());
  nrmsApp.use("/api/owner/nrms/billing", nrmsRouter);
});

beforeEach(() => {
  mocks.gate.mockReset().mockResolvedValue({ enabled: false, reason: "Disabled by administrator" });
  mocks.azampayToken.mockReset();
  mocks.azampayPost.mockReset();
  mocks.coralPost.mockReset();
  const row = {
    id: 8,
    token: "nrms-token",
    statementId: 9,
    amount: 25_000,
    currency: "TZS",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 60_000),
    payment: null,
    statement: {
      id: 9,
      status: "PAYABLE",
      accountId: 10,
      account: {
        id: 10,
        propertyId: 19,
        owner: { name: "Owner", fullName: "Test Owner", email: "owner@example.test", phone: "0712345678" },
        property: { id: 19, title: "Test Hotel" },
      },
    },
  };
  mocks.nrmsTokenFindFirst.mockReset().mockResolvedValueOnce(row).mockResolvedValueOnce(null);
});

function expectNoProviderCall() {
  expect(mocks.azampayToken).not.toHaveBeenCalled();
  expect(mocks.azampayPost).not.toHaveBeenCalled();
  expect(mocks.coralPost).not.toHaveBeenCalled();
}

describe("group-stay payment gates", () => {
  it("blocks disabled MNO initiation", async () => {
    await request(groupApp)
      .post("/api/customer/group-stays/42/deposit/initiate-mno")
      .send({ phoneNumber: "0712345678", provider: "Airtel" })
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("Airtel");
    expectNoProviderCall();
  });

  it("blocks disabled bank initiation", async () => {
    await request(groupApp)
      .post("/api/customer/group-stays/42/deposit/initiate-bank")
      .send({ bankCode: "CRDB", accountNumber: "123", merchantMobileNumber: "0712345678", otp: "123456" })
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("BANK_CRDB");
    expectNoProviderCall();
  });

  it("blocks disabled card initiation", async () => {
    await request(groupApp)
      .post("/api/customer/group-stays/42/deposit/initiate-card")
      .send({})
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("CARD");
    expectNoProviderCall();
  });
});

describe("tour payment gates", () => {
  const accessToken = "tour-access-token-123456";

  it("blocks disabled MNO initiation", async () => {
    await request(tourApp)
      .post("/api/public/tour-bookings/42/initiate-payment")
      .send({ phoneNumber: "0712345678", provider: "Airtel", accessToken })
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("Airtel");
    expectNoProviderCall();
  });

  it("blocks disabled bank initiation", async () => {
    await request(tourApp)
      .post("/api/public/tour-bookings/42/initiate-bank-payment")
      .send({ bankCode: "NMB", accountNumber: "123", merchantMobileNumber: "0712345678", otp: "123456", accessToken })
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("BANK_NMB");
    expectNoProviderCall();
  });

  it("blocks disabled card initiation", async () => {
    await request(tourApp)
      .post("/api/public/tour-bookings/42/initiate-card-payment")
      .send({ accessToken })
      .expect(400, { ok: false, error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("CARD");
    expectNoProviderCall();
  });
});

describe("NRMS billing payment gates", () => {
  it("blocks disabled MNO initiation", async () => {
    await request(nrmsApp)
      .post("/api/owner/nrms/billing/tokens/nrms-token/initiate")
      .send({ channel: "MNO", phoneNumber: "0712345678", provider: "Airtel" })
      .expect(400, { error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("Airtel");
    expectNoProviderCall();
  });

  it("blocks disabled bank initiation", async () => {
    await request(nrmsApp)
      .post("/api/owner/nrms/billing/tokens/nrms-token/initiate")
      .send({ channel: "BANK", bankCode: "CRDB", accountNumber: "123", merchantMobileNumber: "0712345678", otp: "123456" })
      .expect(400, { error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("BANK_CRDB");
    expectNoProviderCall();
  });

  it("blocks disabled card initiation", async () => {
    await request(nrmsApp)
      .post("/api/owner/nrms/billing/tokens/nrms-token/initiate")
      .send({ channel: "CARD" })
      .expect(400, { error: "payment_method_unavailable", message: "Disabled by administrator" });
    expect(mocks.gate).toHaveBeenCalledWith("CARD");
    expectNoProviderCall();
  });
});
