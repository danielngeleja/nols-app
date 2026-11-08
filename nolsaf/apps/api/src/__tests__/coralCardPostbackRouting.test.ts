/**
 * CoralCommerce card notices.
 *
 * 1. Where does a card payer land after Coral sends them back? These drive the
 *    real `/postback` handler and assert the redirect target, including when
 *    Coral echoes NO query string.
 * 2. SECURITY: the postback passes through the payer's browser and Coral's
 *    Blowfish-ECB encryption has no integrity check, so a declined postback can
 *    be turned into "Code 000" by swapping one 8-byte block. The postback must
 *    therefore never settle or fail anything; only the server-to-server
 *    callback, with an explicit Status "Success", can mark a payment paid.
 */

import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindFirst: vi.fn(),
  invoiceFindUnique: vi.fn(),
  tourFindFirst: vi.fn(),
  tourFindUnique: vi.fn(),
  groupFindFirst: vi.fn(),
  groupFindUnique: vi.fn(),
  paymentEventFindUnique: vi.fn(),
  paymentEventFindFirst: vi.fn(),
  paymentEventCreate: vi.fn(),
  paymentEventUpdate: vi.fn(),
  paymentEventUpdateMany: vi.fn(),
  nrmsTokenFindUnique: vi.fn(),
  transaction: vi.fn(),
  markNrmsPaymentFailed: vi.fn(),
  parseCoralEncryptedJson: vi.fn(),
  markInvoicePaid: vi.fn(),
  markTourBookingPaid: vi.fn(),
  markGroupBookingDepositPaid: vi.fn(),
  reconcileNrmsPaymentAndAccrue: vi.fn(),
  releaseFailedBookingPayment: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("../lib/notifications.js", () => ({ notifyAdmins: mocks.notifyAdmins }));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    invoice: { findFirst: mocks.invoiceFindFirst, findUnique: mocks.invoiceFindUnique, updateMany: vi.fn() },
    tourBooking: { findFirst: mocks.tourFindFirst, findUnique: mocks.tourFindUnique, update: vi.fn() },
    groupBooking: { findFirst: mocks.groupFindFirst, findUnique: mocks.groupFindUnique },
    booking: { update: vi.fn() },
    paymentEvent: {
      findUnique: mocks.paymentEventFindUnique,
      findFirst: mocks.paymentEventFindFirst,
      create: mocks.paymentEventCreate,
      update: mocks.paymentEventUpdate,
      updateMany: mocks.paymentEventUpdateMany,
      upsert: vi.fn(),
    },
    nrmsServicePaymentToken: { findUnique: mocks.nrmsTokenFindUnique },
    $transaction: mocks.transaction,
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
  markNrmsPaymentFailed: mocks.markNrmsPaymentFailed,
  reconcileNrmsPaymentAndAccrue: mocks.reconcileNrmsPaymentAndAccrue,
}));

vi.mock("../lib/bookingPaymentAttempt.js", () => ({
  releaseFailedBookingPayment: mocks.releaseFailedBookingPayment,
}));

const WEB = "https://www.nolsaf.test";
const NRMS_REF = "NRMS-C-1234567890ABCDEF1234567890ABCDEF";
const NRMS_TOKEN = "NRMS-1234567890ABCDEF1234567890ABCDEF1234";
let app: express.Express;

/** A successful Coral postback (browser). Per Coral's guide it has no Status field. */
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

/** A final Coral callback (server to server), with its explicit Status. */
function callbackNotice(paymentRef: string, overrides: Record<string, unknown> = {}) {
  return {
    Code: "000",
    Message: "The request was processed successfully",
    TransactionID: "TX-9",
    Stamp: paymentRef,
    Identifier: paymentRef,
    Status: "Success",
    ISOCode: "00",
    ...overrides,
  };
}

/** What we persisted at initiate time: "app" or "web", or nothing at all. */
function persistedIntent(client: "app" | "web" | null) {
  mocks.paymentEventFindFirst.mockResolvedValue(client ? { payload: { client } } : null);
}

beforeAll(async () => {
  process.env.CORAL_UCF_SHARED_ENCRYPTION_KEY = "test-key";
  process.env.WEB_ORIGIN = WEB;
  process.env.CORAL_POSTBACK_SETTLE_WAIT_MS = "0";
  const { default: cardRouter } = await import("../routes/payments.coralcommerce.card.js");
  app = express();
  app.use(express.json());
  app.use("/api/payments/coralcommerce/card", cardRouter);
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEB_ORIGIN = WEB;
  process.env.CORAL_POSTBACK_SETTLE_WAIT_MS = "0";
  delete process.env.CORAL_POSTBACK_SETTLE; // default: "verified"
  mocks.notifyAdmins.mockResolvedValue(undefined);
  mocks.invoiceFindFirst.mockResolvedValue(null);
  mocks.invoiceFindUnique.mockResolvedValue({ status: "PROCESSING" });
  mocks.tourFindFirst.mockResolvedValue(null);
  mocks.tourFindUnique.mockResolvedValue({ paymentStatus: "PENDING" });
  mocks.groupFindFirst.mockResolvedValue(null);
  mocks.groupFindUnique.mockResolvedValue({ depositPaid: false });
  mocks.paymentEventFindUnique.mockResolvedValue(null);
  mocks.paymentEventFindFirst.mockResolvedValue(null);
  mocks.paymentEventCreate.mockResolvedValue({ id: 1 });
  mocks.paymentEventUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: any) => callback({}));
  mocks.markNrmsPaymentFailed.mockResolvedValue(undefined);
  mocks.nrmsTokenFindUnique.mockResolvedValue(null);
  mocks.markInvoicePaid.mockResolvedValue({ ok: true });
  mocks.markTourBookingPaid.mockResolvedValue({ ok: true });
  mocks.markGroupBookingDepositPaid.mockResolvedValue({ ok: true });
  mocks.reconcileNrmsPaymentAndAccrue.mockResolvedValue(undefined);
  mocks.releaseFailedBookingPayment.mockResolvedValue(true);
});

/** Posts the encrypted postback the way Coral does, with an optional query string. */
async function postback(paymentRef: string, query = "") {
  mocks.parseCoralEncryptedJson.mockReturnValue(successPostback(paymentRef));
  return request(app)
    .post(`/api/payments/coralcommerce/card/postback${query}`)
    .field("UCFResponse", "encrypted-blob");
}

async function callback(notice: Record<string, unknown>) {
  mocks.parseCoralEncryptedJson.mockReturnValue(notice);
  return request(app)
    .post("/api/payments/coralcommerce/card/callback")
    .field("UCFCallback", "encrypted-blob");
}

function anInvoice({ paid = true } = {}) {
  mocks.invoiceFindFirst.mockResolvedValue({
    id: 501,
    status: "PROCESSING",
    total: 120000,
    netPayable: null,
    booking: { property: { currency: "TZS" } },
  });
  // What the read-only postback sees: the callback already settled it (or not).
  mocks.invoiceFindUnique.mockResolvedValue({ status: paid ? "PAID" : "PROCESSING" });
}

function aTourBooking() {
  mocks.tourFindFirst.mockResolvedValue({
    id: 77,
    status: "PENDING",
    paymentStatus: "PENDING",
    grossAmount: 90000,
    currency: "TZS",
  });
  mocks.tourFindUnique.mockResolvedValue({ paymentStatus: "PAID" });
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
  mocks.groupFindUnique.mockResolvedValue({ depositPaid: true });
}

/** An NRMS token reached by its checkout session (lookup) and by token (settled check). */
function anNrmsToken({ settled = true, currency = "TZS" } = {}) {
  const token = { token: NRMS_TOKEN, amount: 75000, currency, payment: null, statement: { account: { id: 12 } } };
  mocks.nrmsTokenFindUnique.mockImplementation(async ({ where }: any) => {
    if (where.checkoutSessionId === NRMS_REF) return token;
    if (where.token === NRMS_TOKEN) return { ...token, payment: settled ? { id: 1 } : null };
    return null;
  });
}

function expectNothingWritten() {
  expect(mocks.paymentEventCreate).not.toHaveBeenCalled();
  expect(mocks.paymentEventUpdateMany).not.toHaveBeenCalled();
  expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  expect(mocks.markTourBookingPaid).not.toHaveBeenCalled();
  expect(mocks.markGroupBookingDepositPaid).not.toHaveBeenCalled();
  expect(mocks.reconcileNrmsPaymentAndAccrue).not.toHaveBeenCalled();
  expect(mocks.markNrmsPaymentFailed).not.toHaveBeenCalled();
  expect(mocks.releaseFailedBookingPayment).not.toHaveBeenCalled();
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
  it("resolves an NRMS attempt reference and returns to billing without echoed query parameters", async () => {
    anNrmsToken();

    const res = await postback(NRMS_REF);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${WEB}/owner/nrms/billing\\?`));
    expect(res.headers.location).toContain(`ref=${NRMS_REF}`);
    expect(res.headers.location).toContain("cardReturn=success");
    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    expect(mocks.tourFindFirst).not.toHaveBeenCalled();
    expect(mocks.groupFindFirst).not.toHaveBeenCalled();
    expectNothingWritten();
  });

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

/** A real approval postback: every field agrees, numeric Coral TransactionID. */
function approvalPostback(paymentRef: string, overrides: Record<string, unknown> = {}) {
  return {
    Result: {
      Code: "000",
      Message: "The request was processed successfully",
      TransactionID: "107800000000003202476",
      Stamp: paymentRef,
      Identifier: paymentRef,
      ISOCode: "00",
      ISOMessage: "Approved or completed successfully",
      GatewayID: "107800000000003202476",
      ...overrides,
    },
  };
}

async function postbackWith(notice: unknown) {
  mocks.parseCoralEncryptedJson.mockReturnValue(notice);
  return request(app)
    .post("/api/payments/coralcommerce/card/postback")
    .field("UCFResponse", "encrypted-blob");
}

describe("Coral card postback: failures follow the same door", () => {
  const decline = { Result: { Code: "001", Message: "Declined by issuer", Stamp: "CORAL-501-1", Identifier: "CORAL-501-1", ISOCode: "87" } };

  it("returns a failed app payment to the app and ends the attempt so the traveller can pay again", async () => {
    anInvoice({ paid: false });
    persistedIntent("app");

    const res = await postbackWith(decline);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^nolsaf:\/\/card-return\?/);
    expect(res.headers.location).toContain("cardReturn=failed");
    expect(mocks.releaseFailedBookingPayment).toHaveBeenCalledWith(501, expect.any(Array), "CORALCOMMERCE");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("with CORAL_POSTBACK_SETTLE=off a decline only reports failed and changes nothing", async () => {
    process.env.CORAL_POSTBACK_SETTLE = "off";
    anInvoice({ paid: false });
    persistedIntent("app");

    const res = await postbackWith(decline);

    expect(res.headers.location).toContain("cardReturn=failed");
    expectNothingWritten();
  });
});

describe("Coral card postback: strict approval while callbacks are unproven", () => {
  it("settles a fully consistent approval and alerts admins to check the Coral portal", async () => {
    anInvoice({ paid: false });
    persistedIntent("web");

    const res = await postbackWith(approvalPostback("CORAL-501-1"));

    expect(res.status).toBe(302);
    expect(mocks.markInvoicePaid).toHaveBeenCalledWith(501, "CARD", "CORAL-501-1", undefined, "CORALCOMMERCE", "107800000000003202476", 120000);
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("coral_postback_settlement", expect.objectContaining({
      coralTransactionId: "107800000000003202476", amount: 120000, kind: "Room booking",
    }));
  });

  it("with CORAL_POSTBACK_SETTLE=off even a perfect approval is display-only", async () => {
    process.env.CORAL_POSTBACK_SETTLE = "off";
    anInvoice({ paid: false });
    persistedIntent("web");

    const res = await postbackWith(approvalPostback("CORAL-501-1"));

    expect(res.headers.location).toContain("cardReturn=pending");
    expectNothingWritten();
    // Not settled, but never silent: a person is told to check Coral.
    expect(mocks.notifyAdmins).not.toHaveBeenCalledWith("coral_postback_settlement", expect.anything());
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("coral_postback_unverified", expect.objectContaining({
      coralTransactionId: "107800000000003202476", reason: expect.stringContaining("off"),
    }));
  });

  it("does not re-settle or re-alert a target that is already paid", async () => {
    anInvoice({ paid: true });
    persistedIntent("web");

    const res = await postbackWith(approvalPostback("CORAL-501-1"));

    expect(res.headers.location).toContain("cardReturn=success");
    expectNothingWritten();
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });
});

describe("SECURITY: a forged postback cannot pay anything", () => {
  it("a 'Code 000' postback for an unpaid invoice only reports pending and writes nothing", async () => {
    // Exactly what a one-block ECB swap produces: a declined postback whose
    // Code now reads 000. Our records still say unpaid.
    anInvoice({ paid: false });
    persistedIntent("web");

    const res = await postback("CORAL-501-1", "?invoiceId=501&accessToken=abc");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("cardReturn=pending");
    expectNothingWritten();
  });

  it("does not settle an NRMS token, tour or group deposit from a postback either", async () => {
    anNrmsToken({ settled: false });
    expect((await postback(NRMS_REF)).headers.location).toContain("cardReturn=pending");

    mocks.nrmsTokenFindUnique.mockResolvedValue(null);
    aTourBooking();
    mocks.tourFindUnique.mockResolvedValue({ paymentStatus: "PENDING" });
    expect((await postback("TOUR-CARD-77-1")).headers.location).toContain("cardReturn=pending");

    mocks.tourFindFirst.mockResolvedValue(null);
    aGroupBooking();
    mocks.groupFindUnique.mockResolvedValue({ depositPaid: false });
    expect((await postback("GBDEP-CARD-55-1")).headers.location).toContain("cardReturn=pending");

    expectNothingWritten();
  });

  it("the exact one-block swap (decline with Code flipped to 000) is refused", async () => {
    // Everything except the Code block still comes from the decline.
    anInvoice({ paid: false });
    persistedIntent("web");

    const res = await postbackWith({
      Result: {
        Code: "000", Message: "Transaction declined", TransactionID: "", Stamp: "CORAL-501-1",
        Identifier: "CORAL-501-1", ISOCode: "87", ISOMessage: "declined", GatewayID: "2222",
      },
    });

    expect(res.headers.location).toContain("cardReturn=pending");
    expectNothingWritten();
    // The attempt is surfaced to admins as a possible tampering case.
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("coral_postback_unverified", expect.objectContaining({
      paymentRef: "CORAL-501-1", reason: "the approval fields did not all agree",
    }));
    expect(mocks.notifyAdmins).not.toHaveBeenCalledWith("coral_postback_settlement", expect.anything());
  });

  it("does not raise the unverified alert for a decline or an already-paid target", async () => {
    anInvoice({ paid: true });
    persistedIntent("web");
    await postbackWith(approvalPostback("CORAL-501-1", { ISOCode: "87" }));

    process.env.CORAL_POSTBACK_SETTLE = "off";
    anInvoice({ paid: false });
    await postbackWith({ Result: { Code: "001", Message: "Declined", Stamp: "CORAL-501-1", Identifier: "CORAL-501-1" } });

    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("refuses an approval whose ISO code, message or transaction id does not agree", async () => {
    anInvoice({ paid: false });
    persistedIntent("web");
    for (const bad of [{ ISOCode: "87" }, { Message: "Transaction declined" }, { TransactionID: "" }, { TransactionID: "TX-1" }, { ISOMessage: "declined" }]) {
      const res = await postbackWith(approvalPostback("CORAL-501-1", bad));
      expect(res.headers.location).toContain("cardReturn=pending");
    }
    expectNothingWritten();
  });

  it("a genuine Coral transaction cannot settle a second, different booking", async () => {
    anInvoice({ paid: false });
    persistedIntent("web");
    mocks.paymentEventCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    // That TransactionID already belongs to another invoice.
    mocks.paymentEventFindUnique.mockResolvedValueOnce({ provider: "CORALCOMMERCE", invoiceId: 999, tourBookingId: null, groupBookingId: null });

    const res = await postbackWith(approvalPostback("CORAL-501-1"));

    expect(res.status).toBe(400);
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("a postback-shaped body sent to /callback has no top-level Status and pays nothing", async () => {
    anInvoice({ paid: false });
    const res = await callback(successPostback("CORAL-501-1") as any);
    expect(res.status).toBe(400); // no top-level Identifier: the target cannot be resolved
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });
});

describe("Coral card callback: the only path that settles", () => {
  it("marks an invoice paid on an explicit Success with code 000 and ISO 00", async () => {
    anInvoice({ paid: false });

    const res = await callback(callbackNotice("CORAL-501-1"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCESS");
    expect(mocks.markInvoicePaid).toHaveBeenCalledWith(501, "CARD", "CORAL-501-1", undefined, "CORALCOMMERCE", "TX-9", 120000);
  });

  it("refuses a 'Code 000' callback without an explicit Success status", async () => {
    anInvoice({ paid: false });

    const res = await callback(callbackNotice("CORAL-501-1", { Status: undefined }));

    expect(res.body.status).toBe("PENDING");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("refuses a Success callback whose ISO code is not an approval", async () => {
    anInvoice({ paid: false });

    const res = await callback(callbackNotice("CORAL-501-1", { ISOCode: "51" }));

    expect(res.body.status).toBe("PENDING");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("releases a booking payment on an explicit Failure callback", async () => {
    anInvoice({ paid: false });

    const res = await callback(callbackNotice("CORAL-501-1", { Code: "051", Status: "Failure", ISOCode: "51" }));

    expect(res.body.status).toBe("FAILED");
    expect(mocks.releaseFailedBookingPayment).toHaveBeenCalledWith(501, ["TX-9", "CORAL-501-1"], "CORALCOMMERCE");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("settles an NRMS token from the callback", async () => {
    anNrmsToken({ settled: false, currency: "USD" });

    const res = await callback(callbackNotice(NRMS_REF));

    expect(res.status).toBe(200);
    expect(mocks.reconcileNrmsPaymentAndAccrue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: NRMS_TOKEN, amount: 75000 }),
      "CoralCommerce NRMS"
    );
    expect(mocks.paymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: "USD", status: "PENDING" }),
    }));
    expect(mocks.paymentEventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: "TX-9", status: { in: ["PENDING", "FAILED"] } }),
      data: expect.objectContaining({ status: "SUCCESS" }),
    }));
  });

  it("accepts a duplicate Coral event as an idempotent retry", async () => {
    anNrmsToken({ settled: false });
    mocks.paymentEventCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    mocks.paymentEventFindUnique.mockResolvedValueOnce({ provider: "CORALCOMMERCE" });

    const res = await callback(callbackNotice(NRMS_REF));

    expect(res.status).toBe(200);
    expect(mocks.reconcileNrmsPaymentAndAccrue).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a duplicate event belonging to another provider", async () => {
    anNrmsToken({ settled: false });
    mocks.paymentEventCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    mocks.paymentEventFindUnique.mockResolvedValueOnce({ provider: "AZAMPAY" });

    const res = await callback(callbackNotice(NRMS_REF));

    expect(res.status).toBe(400);
    expect(mocks.reconcileNrmsPaymentAndAccrue).not.toHaveBeenCalled();
  });

  it("does not downgrade a settled Coral event when an Initialised callback arrives late", async () => {
    anNrmsToken({ settled: false });
    mocks.paymentEventCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    mocks.paymentEventFindUnique.mockResolvedValueOnce({ provider: "CORALCOMMERCE" });

    const res = await callback(callbackNotice(NRMS_REF, { Status: "Initialised", TransactionID: "TX-1" }));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
    expect(mocks.paymentEventUpdateMany).not.toHaveBeenCalled();
    expect(mocks.reconcileNrmsPaymentAndAccrue).not.toHaveBeenCalled();
  });

  it("resolves an NRMS callback from an earlier retry through its initiation event", async () => {
    const paymentRef = "NRMS-C-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const token = { token: NRMS_TOKEN, amount: 50000, currency: "TZS", payment: null, statement: { account: { id: 12 } } };
    mocks.nrmsTokenFindUnique.mockImplementation(async ({ where }: any) => (where.token === NRMS_TOKEN ? token : null));
    mocks.paymentEventFindUnique.mockImplementation(async ({ where }: any) => (
      where.eventId === `${paymentRef}-INIT`
        ? { provider: "CORALCOMMERCE", payload: { paymentRef, nrmsToken: NRMS_TOKEN } }
        : null
    ));

    const res = await callback(callbackNotice(paymentRef));

    expect(res.status).toBe(200);
    expect(mocks.reconcileNrmsPaymentAndAccrue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: NRMS_TOKEN }),
      "CoralCommerce NRMS"
    );
  });

  it("fails an NRMS token on an explicit Failure callback and gives its transaction room to finish", async () => {
    anNrmsToken({ settled: false });

    const res = await callback(callbackNotice(NRMS_REF, { Code: "001", Status: "Failure", ISOCode: "05" }));

    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 20_000 });
    expect(mocks.markNrmsPaymentFailed).toHaveBeenCalledWith(expect.anything(), NRMS_TOKEN);
    expect(mocks.reconcileNrmsPaymentAndAccrue).not.toHaveBeenCalled();
  });
});
