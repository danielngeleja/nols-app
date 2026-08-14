import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  auditOrThrow: vi.fn(),
  transaction: vi.fn(),
  getPaymentMethodAvailability: vi.fn(),
  getTransportAvailability: vi.fn(),
  propertyFindUnique: vi.fn(),
  transportFindUnique: vi.fn(),
  transportUpsert: vi.fn(),
  transportDelete: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpsert: vi.fn(),
  token: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    property: {
      findUnique: mocks.propertyFindUnique,
    },
    transportAvailability: {
      findUnique: mocks.transportFindUnique,
      upsert: mocks.transportUpsert,
      delete: mocks.transportDelete,
    },
    paymentMethodAvailability: {
      findUnique: mocks.paymentFindUnique,
      upsert: mocks.paymentUpsert,
    },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 71, role: "ADMIN" };
    next();
  },
  requireRole: mocks.requireRole.mockImplementation((role: string) => (
    _req: any,
    _res: any,
    next: any
  ) => {
    if (role === "ADMIN") next();
  }),
  maybeAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/audit.js", () => ({ auditOrThrow: mocks.auditOrThrow }));

vi.mock("../lib/serviceAvailability.js", () => ({
  KNOWN_PAYMENT_PROVIDERS: [
    { provider: "Airtel", label: "Airtel Money" },
    { provider: "CARD", label: "Debit / Credit Card" },
  ],
  listPaymentMethodAvailability: vi.fn(async () => []),
  listTransportAvailability: vi.fn(async () => []),
  getPaymentMethodAvailability: mocks.getPaymentMethodAvailability,
  getTransportAvailability: mocks.getTransportAvailability,
}));

vi.mock("../lib/redisRateLimitStore.js", () => ({
  rateLimitWithRedis: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../lib/azampay.auth.js", () => ({
  getAzamPayToken: mocks.token,
  invalidateAzamPayToken: vi.fn(),
}));

vi.mock("../lib/draftBookingAvailability.js", () => ({
  computeDraftBookingAvailability: vi.fn(),
  unavailableDraftPaymentResponse: vi.fn(),
}));

vi.mock("../lib/azampay.helpers.js", () => ({
  AZAMPAY_API_URL: "https://example.invalid",
  AZAMPAY_MNO_API_URL: "https://example.invalid",
  FETCH_TIMEOUT_MS: 10_000,
  IDEM_TTL_SEC: 600,
  TZ_PHONE_RE: /^(\+255|0)(6|7|2)\d{8}$/,
  normalizePhone: vi.fn((value: string) => value),
  maskAzamPayPhone: vi.fn(() => "***"),
  describeAzamPayResponseBody: vi.fn(() => ({})),
  azampayPost: vi.fn(),
  azampayMnoPost: vi.fn(),
  idemGet: vi.fn(async () => null),
  idemSet: vi.fn(async () => undefined),
  SUPPORTED_BANK_CODES: ["CRDB", "NMB"],
  CHECKOUT_BANK_CODES: ["CRDB", "NMB"],
  makePaymentRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../lib/coralcommerce.helpers.js", () => ({
  CORAL_UCF_API_URL: "https://example.invalid",
  coralPostJson64: vi.fn(),
  makeCoralRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  parseCoralEncryptedJson: vi.fn(),
  parseCoralInitiateResponse: vi.fn(),
}));

vi.mock("../routes/webhooks.payments.js", () => ({
  markInvoicePaid: vi.fn(),
  markGroupBookingDepositPaid: vi.fn(),
  markTourBookingPaid: vi.fn(),
}));

vi.mock("../lib/nrmsBilling.js", () => ({
  markNrmsPaymentFailed: vi.fn(),
  reconcileNrmsPaymentAndAccrue: vi.fn(),
}));

let adminApp: express.Express;
let mnoApp: express.Express;
let bankApp: express.Express;
let cardApp: express.Express;
let bookingApp: express.Express;

beforeAll(async () => {
  const [
    { default: adminRouter },
    { default: mnoRouter },
    { default: bankRouter },
    { default: cardRouter },
    { default: bookingRouter },
  ] = await Promise.all([
    import("../routes/admin.service-availability.js"),
    import("../routes/payments.azampay.js"),
    import("../routes/payments.azampay.bank.js"),
    import("../routes/payments.coralcommerce.card.js"),
    import("../routes/public.bookings.js"),
  ]);

  adminApp = express();
  adminApp.use(express.json());
  adminApp.use("/api/admin/service-availability", adminRouter);

  mnoApp = express();
  mnoApp.use(express.json());
  mnoApp.use("/api/payments/azampay", mnoRouter);

  bankApp = express();
  bankApp.use(express.json());
  bankApp.use("/api/payments/azampay/bank", bankRouter);

  cardApp = express();
  cardApp.use(express.json());
  cardApp.use("/api/payments/coralcommerce/card", cardRouter);

  bookingApp = express();
  bookingApp.use(express.json());
  bookingApp.use("/api/public/bookings", bookingRouter);
});

beforeEach(() => {
  mocks.auditOrThrow.mockReset().mockResolvedValue(undefined);
  mocks.transaction.mockReset().mockImplementation(async (callback: any) => callback({
    transportAvailability: {
      findUnique: mocks.transportFindUnique,
      upsert: mocks.transportUpsert,
      delete: mocks.transportDelete,
    },
    paymentMethodAvailability: {
      findUnique: mocks.paymentFindUnique,
      upsert: mocks.paymentUpsert,
    },
    auditLog: { create: vi.fn() },
  }));
  mocks.getPaymentMethodAvailability.mockReset().mockResolvedValue({ enabled: true, reason: null });
  mocks.getTransportAvailability.mockReset().mockResolvedValue({ enabled: true, reason: null });
  mocks.propertyFindUnique.mockReset().mockResolvedValue({
    id: 19,
    status: "APPROVED",
    title: "Test Hotel",
    basePrice: 100_000,
    currency: "TZS",
    services: {},
    roomsSpec: [],
    latitude: -6.8,
    longitude: 39.2,
    regionName: "Dar es Salaam",
    district: "Kinondoni",
    ward: "Kijitonyama",
    owner: { id: 7, name: "Owner", email: "owner@example.test", phone: "0712345678" },
  });
  mocks.transportFindUnique.mockReset().mockResolvedValue(null);
  mocks.transportUpsert.mockReset().mockResolvedValue({ id: 9, isEnabled: true });
  mocks.transportDelete.mockReset().mockResolvedValue({ id: 9 });
  mocks.paymentFindUnique.mockReset().mockResolvedValue(null);
  mocks.paymentUpsert.mockReset().mockResolvedValue({ id: 4, provider: "CARD", isEnabled: false });
  mocks.token.mockReset();
});

describe("admin service availability routes", () => {
  it("registers the entire router behind the ADMIN role gate", () => {
    expect(mocks.requireRole).toHaveBeenCalledWith("ADMIN");
  });

  it("rejects a ward without a district before any database mutation", async () => {
    const response = await request(adminApp)
      .put("/api/admin/service-availability/transport")
      .send({
        regionName: "Dar es Salaam",
        district: "",
        ward: "Kijitonyama",
        isEnabled: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: "ward_requires_district" });
    expect(mocks.transportUpsert).not.toHaveBeenCalled();
    expect(mocks.auditOrThrow).not.toHaveBeenCalled();
  });

  it("normalizes parent scopes to empty strings and requests an audit entry", async () => {
    await request(adminApp)
      .put("/api/admin/service-availability/transport")
      .send({ regionName: "Arusha", district: null, ward: null, isEnabled: true })
      .expect(200);

    expect(mocks.transportUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        regionName_district_ward: {
          regionName: "ARUSHA",
          district: "",
          ward: "",
        },
      },
    }));
    expect(mocks.auditOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "ADMIN_TRANSPORT_AVAILABILITY_SET",
      "transport_availability",
      null,
      expect.objectContaining({ id: 9 }),
      9
    );
  });

  it("requests an audit entry for a payment-method toggle", async () => {
    await request(adminApp)
      .put("/api/admin/service-availability/payment-methods/CARD")
      .send({ isEnabled: false, reason: "Maintenance" })
      .expect(200);

    expect(mocks.auditOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "ADMIN_PAYMENT_METHOD_AVAILABILITY_SET",
      "payment_method_availability",
      null,
      expect.objectContaining({ provider: "CARD" }),
      4
    );
  });

  it("rolls the mutation back by surfacing a strict audit failure", async () => {
    mocks.auditOrThrow.mockRejectedValueOnce(new Error("audit unavailable"));

    await request(adminApp)
      .put("/api/admin/service-availability/payment-methods/CARD")
      .send({ isEnabled: false, reason: "Maintenance" })
      .expect(500);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("payment initiate enforcement", () => {
  it("rejects a forged MNO initiate request when the provider is disabled", async () => {
    mocks.getPaymentMethodAvailability.mockResolvedValue({
      enabled: false,
      reason: "Airtel is under maintenance",
    });

    const response = await request(mnoApp)
      .post("/api/payments/azampay/initiate")
      .send({
        invoiceId: 42,
        phoneNumber: "0712345678",
        provider: "Airtel",
      })
      .expect(400);

    expect(response.body).toEqual({
      error: "payment_method_unavailable",
      message: "Airtel is under maintenance",
    });
    expect(mocks.getPaymentMethodAvailability).toHaveBeenCalledWith("Airtel");
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("rejects a forged bank initiate request when the selected bank is disabled", async () => {
    mocks.getPaymentMethodAvailability.mockResolvedValue({
      enabled: false,
      reason: "CRDB is under maintenance",
    });

    const response = await request(bankApp)
      .post("/api/payments/azampay/bank/initiate")
      .send({
        invoiceId: 42,
        bankCode: "CRDB",
        accountNumber: "123456789",
        merchantMobileNumber: "0712345678",
        otp: "123456",
      })
      .expect(400);

    expect(response.body).toEqual({
      error: "payment_method_unavailable",
      message: "CRDB is under maintenance",
    });
    expect(mocks.getPaymentMethodAvailability).toHaveBeenCalledWith("BANK_CRDB");
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("rejects provider-supported banks that are not deliberately published in checkout", async () => {
    await request(bankApp)
      .post("/api/payments/azampay/bank/initiate")
      .send({
        invoiceId: 42,
        bankCode: "NBC",
        accountNumber: "123456789",
        merchantMobileNumber: "0712345678",
        otp: "123456",
      })
      .expect(400);

    expect(mocks.getPaymentMethodAvailability).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("rejects a forged card initiate request when card payments are disabled", async () => {
    mocks.getPaymentMethodAvailability.mockResolvedValue({
      enabled: false,
      reason: "Card processing is under maintenance",
    });

    const response = await request(cardApp)
      .post("/api/payments/coralcommerce/card/initiate")
      .send({ invoiceId: 42 })
      .expect(400);

    expect(response.body).toEqual({
      error: "payment_method_unavailable",
      message: "Card processing is under maintenance",
    });
    expect(mocks.getPaymentMethodAvailability).toHaveBeenCalledWith("CARD");
  });
});

describe("booking transport enforcement", () => {
  it("rejects a forged includeTransport request for a locked property area", async () => {
    mocks.getTransportAvailability.mockResolvedValue({
      enabled: false,
      reason: "No drivers cover this ward",
    });

    const response = await request(bookingApp)
      .post("/api/public/bookings")
      .send({
        propertyId: 19,
        checkIn: "2099-08-20",
        checkOut: "2099-08-22",
        guestName: "Gate Test Guest",
        guestPhone: "+255712345678",
        includeTransport: true,
        transportVehicleType: "CAR",
        transportPickupMode: "manual",
        transportOriginLat: -6.81,
        transportOriginLng: 39.28,
        transportOriginAddress: "Test pickup",
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: "transport_unavailable",
      message: "No drivers cover this ward",
    });
    expect(mocks.getTransportAvailability).toHaveBeenCalledWith(expect.objectContaining({
      id: 19,
      regionName: "Dar es Salaam",
      district: "Kinondoni",
      ward: "Kijitonyama",
    }));
  });
});
