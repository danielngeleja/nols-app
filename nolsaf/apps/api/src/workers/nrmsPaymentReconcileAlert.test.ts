import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tokenFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  notificationFindFirst: vi.fn(),
  accountUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  notifyAdmins: vi.fn(),
  notifyOwner: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  nrmsServicePaymentToken: { findMany: mocks.tokenFindMany },
  paymentEvent: { findMany: mocks.eventFindMany },
  notification: { findFirst: mocks.notificationFindFirst },
  ownerPaygAccount: { update: mocks.accountUpdate },
  user: { findUnique: mocks.userFindUnique },
} }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: mocks.notifyAdmins, notifyOwner: mocks.notifyOwner }));
vi.mock("../lib/mailer.js", () => ({ sendMail: mocks.sendMail }));
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
    statement: {
      account: {
        id: 3,
        ownerId: 20,
        status: "PAYMENT_PENDING",
        unpaidBalance: 62400,
        unpaidLimit: 50000,
        limitReachedAt: minutesAgo(60 * 24 * 5),
        trialEndsAt: null,
        policy: { reminderAmount: 10000, warningAmount: 30000, graceDays: 0, currency: "TZS" },
        property: { title: "Namibia Villa" },
      },
    },
    ...overrides,
  };
}

describe("NRMS payment reconcile alert worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenFindMany.mockResolvedValue([]);
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.accountUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ email: "owner@example.com" });
    mocks.notifyAdmins.mockResolvedValue(undefined);
    mocks.notifyOwner.mockResolvedValue(undefined);
    mocks.sendMail.mockResolvedValue({ success: true });
    delete process.env.NRMS_RECONCILE_ALERT_AFTER_MS;
    delete process.env.NRMS_PENDING_REVERT_FAST_MS;
    delete process.env.NRMS_PENDING_REVERT_SLOW_MS;
  });

  it("reverts an abandoned mobile-money push to payment required within minutes", async () => {
    // Prompt initiated 7 minutes ago, PIN never entered: past the 6 minute fast window.
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(7), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.reverted).toBe(1);
    expect(mocks.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ status: "PAYMENT_REQUIRED" }) }));
    // Under the 10 minute alert threshold: no alarm for a simply abandoned prompt.
    expect(result.alerted).toBe(0);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("leaves a fresh mobile-money attempt alone inside the fast window", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(4), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result).toEqual({ checked: 1, reverted: 0, alerted: 0 });
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
  });

  it("gives card payments the slow window: no revert at 12 minutes, but the alert still fires", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken({ method: "CARD" })]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(12), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.reverted).toBe(0);
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
    expect(result.alerted).toBe(1);
  });

  it("wires the owner in at alert time: in-app notice plus verification email, alongside the admin alert", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(12), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("nrms_payment_reconcile_needed", expect.objectContaining({ nrmsToken: "NRMS-ABC123", waitedMinutes: 12 }));
    expect(mocks.notifyOwner).toHaveBeenCalledWith(20, "nrms_payment_unconfirmed", expect.objectContaining({ propertyTitle: "Namibia Villa", amount: 62400 }));
    expect(mocks.sendMail).toHaveBeenCalledWith("owner@example.com", expect.stringContaining("Namibia Villa"), expect.stringContaining("Do not pay again"));
  });

  it("alerts exactly once per token across repeated sweeps", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken({ method: "CARD" })]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(30), payload: { nrmsToken: "NRMS-ABC123" } }]);
    mocks.notificationFindFirst.mockResolvedValue({ id: 55 });
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(0);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("does not touch an account that already left PAYMENT_PENDING", async () => {
    const token = processingToken();
    (token.statement.account as any).status = "PAYMENT_REQUIRED";
    mocks.tokenFindMany.mockResolvedValue([token]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(20), payload: { nrmsToken: "NRMS-ABC123" } }]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.reverted).toBe(0);
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
    expect(result.alerted).toBe(1);
  });

  it("keeps working when the owner email fails to send", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken()]);
    mocks.eventFindMany.mockResolvedValue([{ createdAt: minutesAgo(12), payload: { nrmsToken: "NRMS-ABC123" } }]);
    mocks.sendMail.mockRejectedValue(new Error("smtp down"));
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalled();
  });

  it("falls back to token creation time when no initiation event is on record", async () => {
    mocks.tokenFindMany.mockResolvedValue([processingToken({ createdAt: minutesAgo(45), method: "CARD" })]);
    mocks.eventFindMany.mockResolvedValue([]);
    const result = await runNrmsPaymentReconcileAlert(NOW);
    expect(result.alerted).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("nrms_payment_reconcile_needed", expect.objectContaining({ waitedMinutes: 45 }));
  });
});
