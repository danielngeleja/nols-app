import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  snapshotUpsert: vi.fn(),
  exceptionFindUnique: vi.fn(),
  exceptionCreate: vi.fn(),
  exceptionUpdate: vi.fn(),
  exceptionUpdateMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { LIFECYCLE_OBSERVATION_TX_OPTIONS, persistLifecycleObservation } from "./lifecycleObservationStore.js";

const tx = {
  lifecycleSnapshot: { upsert: mocks.snapshotUpsert },
  lifecycleException: {
    findUnique: mocks.exceptionFindUnique,
    create: mocks.exceptionCreate,
    update: mocks.exceptionUpdate,
    updateMany: mocks.exceptionUpdateMany,
  },
};

const observation = {
  serviceType: "TOUR" as const,
  bookingId: 19,
  lifecycle: {
    version: 1 as const,
    serviceType: "TOUR" as const,
    bookingStage: "CONFIRMED" as const,
    paymentStage: "PAID" as const,
    receiptStage: "AVAILABLE" as const,
    responsibilityStage: "ASSIGNED" as const,
    caseStage: "NONE" as const,
    requiredAction: "PREPARE_FOR_SERVICE" as const,
    requiredActionLabel: "Prepare for service",
    consistency: { status: "CONSISTENT" as const, issues: [] },
  },
};

describe("persistLifecycleObservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exceptionFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  });

  it("gives the observation transaction enough time to acquire and finish", async () => {
    await persistLifecycleObservation(observation);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), LIFECYCLE_OBSERVATION_TX_OPTIONS);
    expect(LIFECYCLE_OBSERVATION_TX_OPTIONS).toEqual({ maxWait: 10_000, timeout: 30_000 });
  });

  it("retries a temporary P2028 transaction-start failure", async () => {
    const unavailable = Object.assign(new Error("Unable to start a transaction in the given time"), { code: "P2028" });
    mocks.transaction
      .mockRejectedValueOnce(unavailable)
      .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await persistLifecycleObservation(observation);

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.snapshotUpsert).toHaveBeenCalledOnce();
  });
});
