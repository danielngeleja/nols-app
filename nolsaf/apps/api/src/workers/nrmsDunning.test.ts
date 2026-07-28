import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindMany: vi.fn(), accountUpdate: vi.fn(),
  tokenFindFirst: vi.fn(), tokenUpdateMany: vi.fn(),
  transaction: vi.fn(),
  statementFindFirst: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  ownerPaygAccount: { findMany: mocks.accountFindMany, update: mocks.accountUpdate },
  nrmsServicePaymentToken: { findFirst: mocks.tokenFindFirst, updateMany: mocks.tokenUpdateMany },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/notifications.js", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("../lib/nrmsWorkerHealth.js", () => ({ runNrmsWorker: vi.fn((_name: string, task: () => unknown) => task()) }));

import { runNrmsDunning } from "./nrmsDunning.js";

const NOW = new Date("2026-07-23T12:00:00Z");
const PAST = new Date("2026-07-10T12:00:00Z");

// Over-limit PAYMENT_PENDING account: the state a silent provider leaves behind.
function pendingAccount() {
  return {
    id: 3, ownerId: 20, status: "PAYMENT_PENDING",
    unpaidBalance: 62400, unpaidLimit: 50000,
    limitReachedAt: PAST, trialEndsAt: null,
    reminderNotifiedAt: PAST, warningNotifiedAt: PAST, freezeNotifiedAt: PAST,
    policy: { reminderAmount: 10000, warningAmount: 30000, graceDays: 0, currency: "TZS" },
    property: { title: "Namibia Villa" },
  };
}

describe("NRMS dunning: stuck PAYMENT_PENDING recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountUpdate.mockResolvedValue({});
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    // Statement mint short-circuits: a PAYABLE statement already exists.
    mocks.transaction.mockImplementation(async (callback: any) => callback({ nrmsBillingStatement: { findFirst: mocks.statementFindFirst } }));
    mocks.statementFindFirst.mockResolvedValue({ id: 5 });
  });

  it("keeps PAYMENT_PENDING while a live payment attempt is still awaiting the provider", async () => {
    mocks.accountFindMany.mockResolvedValue([pendingAccount()]);
    mocks.tokenFindFirst.mockResolvedValue({ id: 11 });
    await runNrmsDunning(NOW);
    expect(mocks.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ status: "PAYMENT_PENDING" }) }));
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });

  it("expires stale tokens and returns a silent-provider account to PAYMENT_REQUIRED", async () => {
    mocks.accountFindMany.mockResolvedValue([pendingAccount()]);
    mocks.tokenFindFirst.mockResolvedValue(null);
    await runNrmsDunning(NOW);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
      where: { statement: { accountId: 3 }, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { lte: NOW } },
      data: { status: "EXPIRED" },
    });
    // Balance 62,400 over a 50,000 limit with grace elapsed: back to PAYMENT_REQUIRED,
    // so the owner can generate a fresh token and pay again.
    expect(mocks.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ status: "PAYMENT_REQUIRED" }) }));
  });

  it("never runs the live-attempt lookup for accounts that are not PAYMENT_PENDING", async () => {
    mocks.accountFindMany.mockResolvedValue([{ ...pendingAccount(), status: "WARNING", unpaidBalance: 40000 }]);
    await runNrmsDunning(NOW);
    expect(mocks.tokenFindFirst).not.toHaveBeenCalled();
    expect(mocks.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "WARNING" }) }));
  });
});
