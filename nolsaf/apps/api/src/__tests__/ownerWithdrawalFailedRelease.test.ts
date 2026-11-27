import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  notifyOwner: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    disbursement: { findUnique: vi.fn().mockResolvedValue({ amount: 80000, currency: "TZS", sourceType: "OWNER_WITHDRAWAL" }) },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../services/azampay/disbursement/client.js", () => ({ azamPayDisburse: vi.fn() }));
vi.mock("../lib/notifications.js", () => ({
  notifyUser: vi.fn(), notifyOwner: mocks.notifyOwner, notifyAdmins: mocks.notifyAdmins,
}));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn() }));
vi.mock("../lib/pdfDocuments.js", () => ({ generateOwnerDisbursementPdf: vi.fn() }));
vi.mock("../lib/bookingEmailTemplates.js", () => ({ getOwnerDisbursementEmail: vi.fn(() => ({ subject: "", html: "" })) }));

import { applyProviderEvent } from "../services/payouts/ledger";

/** The first production payout: an owner amount withdrawal to M-Pesa that
 * failed in our funding wallet and was reported against our source rail. */
function setup(opts: { recoveryDeduction?: number; status?: string; planVersion?: number } = {}) {
  let disbursement: any = {
    id: 1, externalReferenceId: "NoLSAF-W-2611251933-F7Z0YB", pgReferenceId: "PG-1",
    sourceType: "OWNER_WITHDRAWAL", sourceId: 3, activeSourceKey: "OWNER_WITHDRAWAL:3",
    amount: 80000, currency: "TZS", status: opts.status ?? "PROCESSING", bankName: "vodacom",
    securityReviewReason: null, providerMessage: "Your transaction is in process",
  };
  let challenge: any = { id: 3, userId: 44, planVersion: opts.planVersion ?? 2, totalAmount: 80000, handoffStatus: "DONE" };
  let allocations = [
    { id: 10, challengeId: 3, recoveryDeduction: opts.recoveryDeduction ?? 0, cancelledAt: null as Date | null },
  ];
  const audit: any[] = [];
  const tx = {
    disbursement: {
      findUnique: vi.fn(async () => ({ ...disbursement })),
      update: vi.fn(async ({ data }: any) => { disbursement = { ...disbursement, ...data }; return { ...disbursement }; }),
      updateMany: vi.fn(async ({ data }: any) => {
        if (disbursement.status !== "PROCESSING") return { count: 0 };
        disbursement = { ...disbursement, ...data };
        return { count: 1 };
      }),
    },
    disbursementEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
    payoutWithdrawalChallenge: {
      findUnique: vi.fn(async () => ({ ...challenge })),
      update: vi.fn(async ({ data }: any) => { challenge = { ...challenge, ...data }; return challenge; }),
    },
    payoutWithdrawalAllocation: {
      findMany: vi.fn(async () => allocations.filter((row) => !row.cancelledAt)),
      updateMany: vi.fn(async ({ data }: any) => {
        allocations = allocations.map((row) => (row.cancelledAt ? row : { ...row, ...data }));
        return { count: allocations.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { audit.push(data); return data; }) },
  };
  mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
  const failure = {
    eventType: "STATUS_POLL" as const,
    callback: {
      initiatorReferenceId: "", fspReferenceId: "MO261125.2239.D59235", pgReferenceId: "PG-1",
      amount: "80000", status: "failure", message: "Balance can not be negative", operator: "azampesa",
    },
  };
  return { tx, failure, audit, state: () => ({ disbursement, challenge, allocations }) };
}

describe("failed owner amount withdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyOwner.mockResolvedValue(undefined);
    mocks.notifyAdmins.mockResolvedValue(undefined);
  });

  it("gives the reserved balance back and frees today's limit", async () => {
    const { failure, audit, state } = setup();

    await applyProviderEvent(1, failure);

    const { disbursement, challenge, allocations } = state();
    expect(disbursement.status).toBe("FAILED");
    expect(allocations.every((row) => row.cancelledAt instanceof Date)).toBe(true);
    expect(challenge.handoffStatus).toBe("CANCELLED");
    expect(audit).toEqual([expect.objectContaining({ action: "OWNER_AMOUNT_WITHDRAWAL_FAILED_RELEASED", entityId: 3 })]);
    expect(mocks.notifyOwner).toHaveBeenCalledWith(44, "owner_payout_withdrawal_failed", { amountText: "TZS 80,000" });
    // Our wallet's wording never reaches the owner.
    expect(JSON.stringify(mocks.notifyOwner.mock.calls)).not.toContain("Balance");
  });

  it("leaves a withdrawal that took refund-debt recovery with finance", async () => {
    const { failure, audit, state } = setup({ recoveryDeduction: 5000 });

    await applyProviderEvent(1, failure);

    const { disbursement, challenge, allocations } = state();
    expect(disbursement.status).toBe("FAILED");
    expect(allocations[0].cancelledAt).toBeNull();
    expect(challenge.handoffStatus).toBe("DONE");
    expect(audit).toEqual([]);
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("payout_disbursement_failed", expect.anything());
  });

  it("releases nothing on a repeated event after the payout is already FAILED", async () => {
    const { tx, failure, state } = setup({ status: "FAILED" });

    await applyProviderEvent(1, failure);

    expect(state().allocations[0].cancelledAt).toBeNull();
    expect(tx.payoutWithdrawalAllocation.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("releases nothing when the transfer succeeds", async () => {
    const { failure, state } = setup();

    await applyProviderEvent(1, { ...failure, callback: { ...failure.callback, status: "success", operator: "Vodacom" } }).catch(() => {});

    expect(state().allocations[0].cancelledAt).toBeNull();
    expect(mocks.notifyOwner).not.toHaveBeenCalledWith(44, "owner_payout_withdrawal_failed", expect.anything());
  });
});
