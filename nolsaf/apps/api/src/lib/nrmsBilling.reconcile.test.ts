import { beforeEach, describe, expect, it, vi } from "vitest";
import { markNrmsPaymentFailed, reconcileNrmsPayment } from "./nrmsBilling.js";

// Both functions receive the transaction client as an argument, so the whole
// settlement engine is provable with a plain mock: no database, no provider.
const tx = {
  nrmsServicePaymentToken: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  nrmsBillingStatement: { updateMany: vi.fn() },
  nrmsServicePayment: { create: vi.fn() },
  ownerPaygAccount: { update: vi.fn() },
};

const FUTURE = new Date(Date.now() + 3 * 86400000);
const PAST = new Date(Date.now() - 3 * 86400000);

// Account in PAYMENT_PENDING with the balance over the limit: the exact state
// the reservations gate blocks on while a webhook outcome is awaited.
function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    token: "NRMS-ABC123",
    status: "PROCESSING",
    amount: 62400,
    currency: "TZS",
    expiresAt: FUTURE,
    statementId: 5,
    payment: null,
    statement: {
      id: 5,
      status: "PAYABLE",
      account: {
        id: 3,
        status: "PAYMENT_PENDING",
        unpaidBalance: 62400,
        unpaidLimit: 50000,
        limitReachedAt: PAST,
        trialEndsAt: null,
        policy: { reminderAmount: 10000, warningAmount: 30000, graceDays: 0, currency: "TZS" },
      },
    },
    ...overrides,
  };
}

const reconcileInput = { token: "NRMS-ABC123", provider: "AZAMPAY", providerRef: "evt-1", idempotencyKey: "AZAMPAY:evt-1", amount: 62400 };

describe("reconcileNrmsPayment (webhook success path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.nrmsBillingStatement.updateMany.mockResolvedValue({ count: 1 });
    tx.nrmsServicePayment.create.mockImplementation(async ({ data }: any) => ({ id: 77, ...data }));
    tx.nrmsServicePaymentToken.update.mockResolvedValue({});
    tx.nrmsServicePaymentToken.updateMany.mockResolvedValue({ count: 0 });
    tx.ownerPaygAccount.update.mockResolvedValue({});
  });

  it("settles the statement, verifies the payment and reopens the account without any manual step", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    const payment = await reconcileNrmsPayment(tx, reconcileInput);

    expect(tx.nrmsBillingStatement.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: "PAYABLE" }, data: expect.objectContaining({ status: "PAID" }) });
    expect(payment).toEqual(expect.objectContaining({ provider: "AZAMPAY", providerRef: "evt-1", status: "VERIFIED", amount: 62400 }));
    expect(tx.nrmsServicePaymentToken.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { status: "PAID" } });
    // Balance paid in full and the sticky PAYMENT_PENDING state is exited:
    // the recompute must land on ACTIVE, not stay pending.
    expect(tx.ownerPaygAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ unpaidBalance: 0, status: "ACTIVE" }) }));
  });

  it("voids every sibling token so an abandoned second attempt can never double-charge", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    await reconcileNrmsPayment(tx, reconcileInput);
    expect(tx.nrmsServicePaymentToken.updateMany).toHaveBeenCalledWith({
      where: { statementId: 5, id: { not: 11 }, status: { in: ["PENDING", "PROCESSING", "FAILED", "EXPIRED"] } },
      data: { status: "VOID" },
    });
  });

  it("is idempotent: a repeated provider callback returns the existing payment and writes nothing", async () => {
    const existing = { id: 99, status: "VERIFIED" };
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow({ payment: existing }));
    await expect(reconcileNrmsPayment(tx, reconcileInput)).resolves.toBe(existing);
    expect(tx.nrmsBillingStatement.updateMany).not.toHaveBeenCalled();
    expect(tx.nrmsServicePayment.create).not.toHaveBeenCalled();
    expect(tx.ownerPaygAccount.update).not.toHaveBeenCalled();
  });

  it("rejects an amount mismatch before touching the statement", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    await expect(reconcileNrmsPayment(tx, { ...reconcileInput, amount: 62399 })).rejects.toThrow("NRMS_PAYMENT_AMOUNT_MISMATCH");
    expect(tx.nrmsBillingStatement.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: PAST }));
    await expect(reconcileNrmsPayment(tx, reconcileInput)).rejects.toThrow("NRMS_TOKEN_EXPIRED");
  });

  it("lets exactly one concurrent callback win the PAYABLE -> PAID claim", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    tx.nrmsBillingStatement.updateMany.mockResolvedValue({ count: 0 });
    await expect(reconcileNrmsPayment(tx, reconcileInput)).rejects.toThrow("NRMS_STATEMENT_NOT_PAYABLE");
    expect(tx.nrmsServicePayment.create).not.toHaveBeenCalled();
    expect(tx.ownerPaygAccount.update).not.toHaveBeenCalled();
  });
});

describe("markNrmsPaymentFailed (webhook failure path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.nrmsServicePaymentToken.updateMany.mockResolvedValue({ count: 1 });
    tx.ownerPaygAccount.update.mockResolvedValue({});
  });

  it("fails the token and moves the account out of PAYMENT_PENDING to the true delinquency state", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    await markNrmsPaymentFailed(tx, "NRMS-ABC123");
    expect(tx.nrmsServicePaymentToken.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "FAILED" } });
    // Balance 62,400 over a 50,000 limit with the grace window elapsed:
    // the account must return to PAYMENT_REQUIRED so the owner can pay again.
    expect(tx.ownerPaygAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ status: "PAYMENT_REQUIRED" }) }));
  });

  it("does nothing when the token already produced a verified payment", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow({ payment: { id: 99 } }));
    await markNrmsPaymentFailed(tx, "NRMS-ABC123");
    expect(tx.nrmsServicePaymentToken.updateMany).not.toHaveBeenCalled();
    expect(tx.ownerPaygAccount.update).not.toHaveBeenCalled();
  });

  it("does nothing when a concurrent settle already changed the token state", async () => {
    tx.nrmsServicePaymentToken.findUnique.mockResolvedValue(tokenRow());
    tx.nrmsServicePaymentToken.updateMany.mockResolvedValue({ count: 0 });
    await markNrmsPaymentFailed(tx, "NRMS-ABC123");
    expect(tx.ownerPaygAccount.update).not.toHaveBeenCalled();
  });
});
