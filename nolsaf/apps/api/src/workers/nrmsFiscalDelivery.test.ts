import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  receiptFindMany: vi.fn(),
  receiptUpdate: vi.fn(),
  receiptUpdateMany: vi.fn(),
  connectionFindMany: vi.fn(),
  connectionFindUnique: vi.fn(),
  connectionUpdate: vi.fn(),
  connectionUpdateMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsFiscalReceipt: { findMany: mocks.receiptFindMany, update: mocks.receiptUpdate, updateMany: mocks.receiptUpdateMany },
    nrmsFiscalConnection: {
      findMany: mocks.connectionFindMany,
      findUnique: mocks.connectionFindUnique,
      update: mocks.connectionUpdate,
      updateMany: mocks.connectionUpdateMany,
    },
  },
}));
vi.mock("../lib/nrmsWorkerHealth.js", () => ({ runNrmsWorker: vi.fn((_name: string, task: () => unknown) => task()) }));

import { deliverPropertyQueue, runNrmsFiscalDelivery, setFiscalAdapter } from "./nrmsFiscalDelivery.js";

const NOW = new Date("2026-08-28T09:00:00.000Z");
const CONNECTION = { id: 5, propertyId: 12 };

function receipt(globalCounter: number, overrides: Record<string, unknown> = {}) {
  return { id: globalCounter, connectionId: 5, propertyId: 12, globalCounter, attemptCount: 0, status: "PENDING", submissionKey: `submission-${globalCounter}`, ...overrides };
}

const ok = {
  fiscalReceiptNumber: "41",
  verificationCode: "ABC123",
  verificationUrl: "https://virtual.tra.go.tz/efdmsRctVerify/ABC123",
  signature: "sig",
  responseDigest: "digest",
  issuedAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.receiptUpdate.mockResolvedValue({});
  mocks.receiptUpdateMany.mockResolvedValue({ count: 1 });
  mocks.connectionUpdate.mockResolvedValue({});
  mocks.connectionUpdateMany.mockResolvedValue({ count: 0 });
  mocks.connectionFindUnique.mockResolvedValue({ status: "ACTIVE", mode: "ALWAYS", escalatedAt: null });
  setFiscalAdapter(async () => ok);
});

describe("deliverPropertyQueue", () => {
  it("sends in global counter order, which is the order TRA requires", async () => {
    mocks.receiptFindMany.mockResolvedValue([receipt(41), receipt(42), receipt(43)]);
    const outcome = await deliverPropertyQueue(CONNECTION, NOW);
    expect(outcome.sent).toBe(3);
    expect(mocks.receiptFindMany.mock.calls[0][0].orderBy).toEqual({ globalCounter: "asc" });
  });

  it("stops at the first failure instead of sending later documents around it", async () => {
    // 42 fails. Sending 43 next would submit an out-of-sequence counter, so the
    // whole queue behind the failure waits.
    mocks.receiptFindMany.mockResolvedValue([receipt(41), receipt(42), receipt(43)]);
    let call = 0;
    setFiscalAdapter(async () => {
      call += 1;
      if (call === 2) throw new Error("TRA unreachable");
      return ok;
    });

    const outcome = await deliverPropertyQueue(CONNECTION, NOW);
    expect(outcome).toEqual({ sent: 1, failed: 1, deadLettered: 0 });
    // Only 41 confirmed and 42 marked failed. 43 was never attempted.
    const terminalWrites = mocks.receiptUpdateMany.mock.calls.filter((c) => ["CONFIRMED", "FAILED", "DEAD_LETTER"].includes(c[0].data.status));
    expect(terminalWrites).toHaveLength(2);
    const touched = terminalWrites.map((c) => c[0].where.id);
    expect(touched).toEqual([41, 42]);
  });

  it("schedules a retry and keeps the document alive", async () => {
    mocks.receiptFindMany.mockResolvedValue([receipt(41)]);
    setFiscalAdapter(async () => {
      throw new Error("TRA unreachable");
    });

    await deliverPropertyQueue(CONNECTION, NOW);
    const data = mocks.receiptUpdateMany.mock.calls.find((call) => call[0].data.status === "FAILED")![0].data;
    expect(data.status).toBe("FAILED");
    const claim = mocks.receiptUpdateMany.mock.calls.find((call) => call[0].data.status === "SENDING")![0].data;
    expect(claim.attemptCount).toEqual({ increment: 1 });
    expect(data.lastError).toBe("FISCAL_PROVIDER_UNAVAILABLE");
    // First backoff step is one minute.
    expect(data.nextAttemptAt.toISOString()).toBe("2026-08-28T09:01:00.000Z");
  });

  it("dead letters after the retry table is exhausted and stops rescheduling", async () => {
    mocks.receiptFindMany.mockResolvedValue([receipt(41, { attemptCount: 5 })]);
    setFiscalAdapter(async () => {
      throw new Error("Rejected: invalid TIN");
    });

    const outcome = await deliverPropertyQueue(CONNECTION, NOW);
    expect(outcome.deadLettered).toBe(1);
    const data = mocks.receiptUpdateMany.mock.calls.find((call) => call[0].data.status === "DEAD_LETTER")![0].data;
    expect(data.status).toBe("DEAD_LETTER");
    expect(data.nextAttemptAt).toBeNull();
    // A dead letter takes the connection itself to FAILED so the owner sees it.
    expect(mocks.connectionUpdateMany.mock.calls[0][0].data.status).toBe("FAILED");
  });

  it("starts the escalation clock on the first failure and does not move it on later ones", async () => {
    const firstFailure = new Date("2026-08-28T08:00:00.000Z");
    mocks.connectionFindUnique.mockResolvedValue({ status: "ACTIVE", mode: "ALWAYS", escalatedAt: firstFailure });
    mocks.receiptFindMany.mockResolvedValue([receipt(41)]);
    setFiscalAdapter(async () => {
      throw new Error("still down");
    });

    await deliverPropertyQueue(CONNECTION, NOW);
    // Section 7.4 measures a shift against the FIRST failure, so this timestamp
    // must not drift forward with every retry.
    expect(mocks.connectionUpdateMany.mock.calls[0][0].data.escalatedAt).toBe(firstFailure);
  });

  it("clears the error state on a clean pass", async () => {
    mocks.receiptFindMany.mockResolvedValue([receipt(41)]);
    await deliverPropertyQueue(CONNECTION, NOW);
    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
      where: { id: 5, status: { in: ["ACTIVE", "FAILED"] } },
      data: { lastSuccessAt: NOW, lastError: null, escalatedAt: null, status: "ACTIVE" },
    });
  });

  it("records nothing when there is nothing queued", async () => {
    mocks.receiptFindMany.mockResolvedValue([]);
    const outcome = await deliverPropertyQueue(CONNECTION, NOW);
    expect(outcome).toEqual({ sent: 0, failed: 0, deadLettered: 0 });
    expect(mocks.connectionUpdateMany).not.toHaveBeenCalled();
  });

  it("stops when another worker already owns the FIFO head", async () => {
    const submit = vi.fn(async (..._args: any[]) => ok);
    setFiscalAdapter(submit);
    mocks.receiptFindMany.mockResolvedValue([receipt(41), receipt(42)]);
    mocks.receiptUpdateMany.mockResolvedValueOnce({ count: 0 });

    const outcome = await deliverPropertyQueue(CONNECTION, NOW);

    expect(outcome).toEqual({ sent: 0, failed: 0, deadLettered: 0 });
    expect(submit).not.toHaveBeenCalled();
    expect(mocks.receiptUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("does not skip an unexpired in-flight head to submit the next counter", async () => {
    const submit = vi.fn(async (..._args: any[]) => ok);
    setFiscalAdapter(submit);
    mocks.receiptFindMany.mockResolvedValue([
      receipt(41, { status: "SENDING", deliveryLeaseExpiresAt: new Date(NOW.getTime() + 60_000) }),
      receipt(42),
    ]);

    await deliverPropertyQueue(CONNECTION, NOW);

    expect(submit).not.toHaveBeenCalled();
    expect(mocks.receiptUpdateMany).not.toHaveBeenCalled();
  });

  it("does not skip a failed head while its retry backoff is still running", async () => {
    const submit = vi.fn(async (..._args: any[]) => ok);
    setFiscalAdapter(submit);
    mocks.receiptFindMany.mockResolvedValue([
      receipt(41, { status: "FAILED", nextAttemptAt: new Date(NOW.getTime() + 60_000) }),
      receipt(42),
    ]);

    await deliverPropertyQueue(CONNECTION, NOW);

    expect(submit).not.toHaveBeenCalled();
    expect(mocks.receiptUpdateMany).not.toHaveBeenCalled();
  });

  it("passes the stable submission key to the adapter for provider idempotency", async () => {
    const submit = vi.fn(async (..._args: any[]) => ok);
    setFiscalAdapter(submit);
    mocks.receiptFindMany.mockResolvedValue([receipt(41)]);

    await deliverPropertyQueue(CONNECTION, NOW);

    expect(submit.mock.calls[0][2]).toEqual({ idempotencyKey: "submission-41" });
  });
});

describe("runNrmsFiscalDelivery", () => {
  it("does no work when no property has a live connection with a queue", async () => {
    mocks.connectionFindMany.mockResolvedValue([]);
    const result = await runNrmsFiscalDelivery(NOW);
    expect(result).toEqual({ properties: 0, sent: 0, failed: 0, deadLettered: 0 });
    expect(mocks.receiptFindMany).not.toHaveBeenCalled();
  });

  it("only looks at connections that are live and actually holding documents", async () => {
    mocks.connectionFindMany.mockResolvedValue([]);
    await runNrmsFiscalDelivery(NOW);
    const where = mocks.connectionFindMany.mock.calls.at(-1)![0].where;
    // A property in OFF, or one still waiting for its business-day activation,
    // is never touched.
    expect(where.status).toEqual({ in: ["ACTIVE", "FAILED"] });
    expect(where.mode).toEqual({ in: ["ALWAYS", "ON_REQUEST"] });
    expect(where.receipts).toEqual({ some: { status: { in: ["PENDING", "FAILED", "SENDING"] } } });
  });

  it("keeps one property's failure from stopping another property's queue", async () => {
    mocks.connectionFindMany.mockResolvedValue([{ id: 5, propertyId: 12 }, { id: 6, propertyId: 13 }]);
    mocks.receiptFindMany.mockImplementation(async (args: any) =>
      args.where.connectionId === 5 ? [receipt(41)] : [{ ...receipt(9), connectionId: 6, propertyId: 13 }],
    );
    setFiscalAdapter(async (r: any) => {
      if (r.connectionId === 5) throw new Error("this hotel's line is down");
      return ok;
    });

    const result = await runNrmsFiscalDelivery(NOW);
    expect(result.properties).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe("the unimplemented adapter", () => {
  it("leaves documents queued rather than pretending they were filed", async () => {
    // Default state until the real TRA specification is in hand. The important
    // property is that nothing is ever marked CONFIRMED without a provider
    // response, so an unfiled receipt can never look filed.
    vi.resetModules();
    const fresh = await import("./nrmsFiscalDelivery.js");
    mocks.receiptFindMany.mockResolvedValue([receipt(41)]);
    await fresh.deliverPropertyQueue(CONNECTION, NOW);
    const data = mocks.receiptUpdateMany.mock.calls.find((call) => call[0].data.status === "FAILED")![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.lastError).toBe("FISCAL_ADAPTER_UNAVAILABLE");
  });
});
