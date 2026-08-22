/**
 * Where does a card payer land after CoralCommerce sends them back?
 *
 * These tests drive the real `/postback` handler with a decrypted Coral payload
 * and assert the redirect target. The cases that matter most are the ones where
 * Coral gives us back NO query string: routing must still come out right, because
 * nothing in the Coral integration guide promises our postback query params are
 * echoed. Sending an app payer to the web page (or a web payer to nolsaf://) is
 * the exact defect these cover.
 */

import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindFirst: vi.fn(),
  tourFindFirst: vi.fn(),
  groupFindFirst: vi.fn(),
  paymentEventFindUnique: vi.fn(),
  paymentEventFindFirst: vi.fn(),
  paymentEventCreate: vi.fn(),
  paymentEventUpdate: vi.fn(),
  parseCoralEncryptedJson: vi.fn(),
  markInvoicePaid: vi.fn(),
  markTourBookingPaid: vi.fn(),
  markGroupBookingDepositPaid: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    invoice: { findFirst: mocks.invoiceFindFirst, findUnique: vi.fn(), updateMany: vi.fn() },
    tourBooking: { findFirst: mocks.tourFindFirst, update: vi.fn() },
    groupBooking: { findFirst: mocks.groupFindFirst },
    booking: { update: vi.fn() },
    paymentEvent: {
      findUnique: mocks.paymentEventFindUnique,
      findFirst: mocks.paymentEventFindFirst,
      create: mocks.paymentEventCreate,
      update: mocks.paymentEventUpdate,
      upsert: vi.fn(),
    },
    nrmsServicePaymentToken: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 9, role: "CUSTOMER" };
    next();
  },
  maybeAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/serviceAvailability.js", () => ({
  getPaymentMethodAvailability: vi.fn(async () => ({ enabled: true })),
}));

vi.mock("../lib/draftBookingAvailability.js", () => ({
  computeDraftBookingAvailability: vi.fn(),
  unavailableDraftPaymentResponse: vi.fn(),
}));

vi.mock("../lib/azampay.helpers.js", () => ({
  IDEM_TTL_SEC: 600,
  idemGet: vi.fn(async () => null),
  idemSet: vi.fn(async () => undefined),
}));

vi.mock("../lib/coralcommerce.helpers.js", () => ({
  CORAL_UCF_API_URL: "https://example.invalid",
  coralPostJson64: vi.fn(),
  makeCoralRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  parseCoralEncryptedJson: mocks.parseCoralEncryptedJson,
  parseCoralInitiateResponse: vi.fn(),
}));

vi.mock("../routes/webhooks.payments.js", () => ({
  markInvoicePaid: mocks.markInvoicePaid,
  markTourBookingPaid: mocks.markTourBookingPaid,
  markGroupBookingDepositPaid: mocks.markGroupBookingDepositPaid,
}));

vi.mock("../lib/nrmsBilling.js", () => ({
  markNrmsPaymentFailed: vi.fn(),
  reconcileNrmsPaymentAndAccrue: vi.fn(),
}));

const WEB = "https://www.nolsaf.test";
let app: express.Express;

/** A successful Coral postback for the given merchant reference. */
function successPostback(paymentRef: string) {
  return {
    Result: {
      Code: "000",
      Message: "The request was processed successfully",
      TransactionID: "TX-1",
      Stamp: paymentRef,
      Identifier: paymentRef,
      ISOCode: "00",
    },
  };
}

/** What we persisted at initiate time: "app" or "web", or nothing at all. */
function persistedIntent(client: "app" | "web" | null) {
  mocks.paymentEventFindFirst.mockResolvedValue(client ? { payload: { client } } : null);
}

beforeAll(async () => {
  process.env.CORAL_UCF_SHARED_ENCRYPTION_KEY = "test-key";
  process.env.WEB_ORIGIN = WEB;
  const { default: cardRouter } = await import("../routes/payments.coralcommerce.card.js");
  app = express();
  app.use(express.json());
  app.use("/api/payments/coralcommerce/card", cardRouter);
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEB_ORIGIN = WEB;
  mocks.invoiceFindFirst.mockResolvedValue(null);
  mocks.tourFindFirst.mockResolvedValue(null);
  mocks.groupFindFirst.mockResolvedValue(null);
  mocks.paymentEventFindUnique.mockResolvedValue(null);
  mocks.paymentEventFindFirst.mockResolvedValue(null);
  mocks.paymentEventCreate.mockResolvedValue({ id: 1 });
  mocks.markInvoicePaid.mockResolvedValue({ ok: true });
  mocks.markTourBookingPaid.mockResolvedValue({ ok: true });
  mocks.markGroupBookingDepositPaid.mockResolvedValue({ ok: true });
});

/** Posts the encrypted postback the way Coral does, with an optional query string. */
async function postback(paymentRef: string, query = "") {
  mocks.parseCoralEncryptedJson.mockReturnValue(successPostback(paymentRef));
  return request(app)
    .post(`/api/payments/coralcommerce/card/postback${query}`)
    .field("UCFResponse", "encrypted-blob");
}

function anInvoice() {
  mocks.invoiceFindFirst.mockResolvedValue({
    id: 501,
    status: "PROCESSING",
    total: 120000,
    netPayable: null,
    booking: { property: { currency: "TZS" } },
  });
}

function aTourBooking() {
  mocks.tourFindFirst.mockResolvedValue({
    id: 77,
    status: "PENDING",
    paymentStatus: "PENDING",
    grossAmount: 90000,
    currency: "TZS",
  });
}

function aGroupBooking() {
  mocks.groupFindFirst.mockResolvedValue({
    id: 55,
    userId: 9,
    depositAmount: 50000,
    depositPaid: false,
    currency: "TZS",
    assignedOwnerId: 3,
    confirmedPropertyId: 4,
    checkIn: new Date("2026-09-01"),
    checkOut: new Date("2026-09-04"),
    roomsNeeded: 2,
    toRegion: "Arusha",
    toDistrict: "Arusha City",
  });
}

describe("Coral card postback: app payers return to the app", () => {
  it("sends a booking payer back to the app when Coral echoes nothing", async () => {
    anInvoice();
    persistedIntent("app");

    const res = await postback("CORAL-501-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/card-return\?/);
    expect(res.headers.location).toContain("cardReturn=success");
    expect(res.headers.location).toContain("invoiceId=501");
    expect(res.headers.location).not.toContain(WEB);
  });

  it("sends a booking payer back to the app on the echoed flag alone", async () => {
    anInvoice();
    persistedIntent(null); // nothing persisted; only the query survived

    const res = await postback("CORAL-501-1", "?client=app&invoiceId=501");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/card-return\?/);
  });

  it("sends a tour payer back to the app without echoed tourBookingId or accessToken", async () => {
    aTourBooking();
    persistedIntent("app");

    const res = await postback("TOUR-CARD-77-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/tour-card-return\?/);
    expect(res.headers.location).toContain("tourBookingId=77");
  });

  it("sends a group stay payer back to the app", async () => {
    aGroupBooking();
    persistedIntent("app");

    const res = await postback("GBDEP-CARD-55-1");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/group-stay-card-return\?/);
    expect(res.headers.location).toContain("groupBookingId=55");
  });
});

describe("Coral card postback: web payers stay on the web", () => {
  it("keeps a booking payer on the web payment page", async () => {
    anInvoice();
    persistedIntent("web");

    const res = await postback("CORAL-501-1", "?invoiceId=501&accessToken=abc");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${WEB}/public/booking/payment?cardReturn=success&ref=CORAL-501-1&message=The+request+was+processed+successfully&invoiceId=501&accessToken=abc`
    );
  });

  it("keeps a group stay payer on the web deposit page instead of a dead app scheme", async () => {
    aGroupBooking();
    persistedIntent("web");

    const res = await postback("GBDEP-CARD-55-1", "?kind=group_stay_deposit&groupBookingId=55&client=web");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${WEB}/account/group-stays/55/deposit\\?`));
    expect(res.headers.location).not.toContain("nolsaf://");
  });

  it("keeps a tour payer on the web tour payment page", async () => {
    aTourBooking();
    persistedIntent("web");

    const res = await postback("TOUR-CARD-77-1", "?tourBookingId=77&accessToken=abc");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${WEB}/public/booking/tour-payment\\?`));
    expect(res.headers.location).toContain("accessToken=abc");
  });
});

describe("Coral card postback: failures follow the same door", () => {
  it("returns a failed app payment to the app with cardReturn=failed", async () => {
    anInvoice();
    persistedIntent("app");
    mocks.parseCoralEncryptedJson.mockReturnValue({
      Result: {
        Code: "001",
        Message: "Declined by issuer",
        Status: "Failure",
        Stamp: "CORAL-501-1",
        Identifier: "CORAL-501-1",
      },
    });

    const res = await request(app)
      .post("/api/payments/coralcommerce/card/postback")
      .field("UCFResponse", "encrypted-blob");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/card-return\?/);
    expect(res.headers.location).toContain("cardReturn=failed");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });
});
