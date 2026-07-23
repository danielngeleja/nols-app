import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tokenFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  nrmsServicePaymentToken: { findMany: mocks.tokenFindMany },
  paymentEvent: { findMany: mocks.eventFindMany },
  notification: { findFirst: mocks.notificationFindFirst },
} }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock("../lib/nrmsWorkerHealth.js", () => ({ runNrmsWorker: vi.fn((_name: string, task: () => unknown) => task()) }));

import { runNrmsPaymentReconcileAlert } from "./nrmsPaymentReconcileAlert.js";

const NOW = new Date("2026-07-23T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function processingToken(overrides: Record<string, unknown> = {}) {
  return {
    token: "NRMS-ABC123",
    status: "PROCESSING",
    amount: 62400,
    currency: "TZS",
    method: "MNO",
    createdAt: minutesAgo(60 * 24),
    statement: { account: { property: { title: "Namibia Villa" } } },
    ...overrides,
  };
}

describe("NRMS payment reconcile alert worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenFindMany.mockResolvedValue([]);
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.notifyAdmins.mockResolvedValue(undefined);
    delete process.env.NRMS_RECONCILE_ALERT_AFTER_MS;
  });

  it("alerts admins once a payment attempt passes 10 minutes with no provider verdict", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(12), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result).toEqual({ checked: 1, alerted: 1 });
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("nrms_payment_reconcile_needed", expect.objectContaining({
      nrmsToken: "NRMS-ABC123", propertyTitle: "Namibia Villa", amount: 62400, currency: "TZS", method: "MNO", waitedMinutes: 12,
    }));
  });

  it("stays quiet inside the 10 minute window so normal confirmations never alarm anyone", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(5), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result).toEqual({ checked: 1, alerted: 0 });
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("measures from initiation, not token creation: an old token initiated moments ago is not stale", async () => {
    // Token minted a day ago by dunning, owner tapped pay 3 minutes ago.
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(3), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(0);
  });

  it("alerts exactly once per token across repeated sweeps", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(30), payload: { nrmsToken: "NRMS-ABC123" } }]);
    mocks.notificationFindFirst.mockResolvedValue({ id: 55 });
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result).toEqual({ checked: 1, alerted: 0 });
    expect(mocks.notificationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ meta: { path: "$.nrmsToken", equals: "NRMS-ABC123" } }),
    }));
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("falls back to token creation time when no initiation event is on record", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken({ createdAt: minutesAgo(45) })]);
    mocks.eventFindMany.mockResolvedValue([]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("nrms_payment_reconcile_needed", expect.objectContaining({ waitedMinutes: 45 }));
  });
});
