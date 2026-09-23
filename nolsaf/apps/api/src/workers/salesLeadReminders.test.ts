import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadFindMany: vi.fn(),
  notificationFindMany: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    salesLead: { findMany: mocks.leadFindMany },
    notification: { findMany: mocks.notificationFindMany },
  },
}));
vi.mock("../lib/notifications.js", () => ({ notifyUser: mocks.notifyUser }));

import { followUpKey, protectionKey, protectionThreshold, runSalesLeadReminders } from "./salesLeadReminders.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-23T08:00:00.000Z");

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    propertyName: "Jamirex Hotel",
    nextFollowUpAt: null,
    protectionExpiresAt: null,
    salesPartner: { userId: 55 },
    ...overrides,
  };
}

describe("sales lead reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationFindMany.mockResolvedValue([]);
  });

  it("reminds the partner once when a follow-up date arrives, linking to the lead", async () => {
    const due = new Date(now.getTime() - 60 * 60 * 1000);
    mocks.leadFindMany
      .mockResolvedValueOnce([lead({ nextFollowUpAt: due })]) // follow-ups
      .mockResolvedValueOnce([]); // protection

    await expect(runSalesLeadReminders(now)).resolves.toEqual({ followUps: 1, protection: 0 });
    expect(mocks.notifyUser).toHaveBeenCalledWith(55, "sales_partner_lead_followup", expect.objectContaining({
      leadId: 7,
      propertyName: "Jamirex Hotel",
      dedupeKey: followUpKey(7, due),
      actionPath: "/sales/leads/7",
    }));
  });

  it("does not repeat a reminder whose key was already sent", async () => {
    const due = new Date(now.getTime() - 60 * 60 * 1000);
    mocks.leadFindMany.mockResolvedValueOnce([lead({ nextFollowUpAt: due })]).mockResolvedValueOnce([]);
    mocks.notificationFindMany.mockResolvedValue([{ meta: { dedupeKey: followUpKey(7, due) } }]);

    await expect(runSalesLeadReminders(now)).resolves.toEqual({ followUps: 0, protection: 0 });
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });

  it("reminds again when the partner reschedules the follow-up", async () => {
    const oldDue = new Date(now.getTime() - 5 * DAY);
    const newDue = new Date(now.getTime() - 60 * 1000);
    mocks.leadFindMany.mockResolvedValueOnce([lead({ nextFollowUpAt: newDue })]).mockResolvedValueOnce([]);
    mocks.notificationFindMany.mockResolvedValue([{ meta: { dedupeKey: followUpKey(7, oldDue) } }]);

    await expect(runSalesLeadReminders(now)).resolves.toEqual({ followUps: 1, protection: 0 });
  });

  it("warns at 7 days and again at 1 day before a claim lapses", async () => {
    const expiresAt = new Date(now.getTime() + 6 * DAY);
    mocks.leadFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([lead({ protectionExpiresAt: expiresAt })]);

    await expect(runSalesLeadReminders(now)).resolves.toEqual({ followUps: 0, protection: 1 });
    expect(mocks.notifyUser).toHaveBeenCalledWith(55, "sales_partner_lead_protection_expiring", expect.objectContaining({
      daysRemaining: 6,
      dedupeKey: protectionKey(7, expiresAt, 7),
    }));

    expect(protectionThreshold(expiresAt, now)).toBe(7);
    expect(protectionThreshold(expiresAt, new Date(expiresAt.getTime() - 12 * 60 * 60 * 1000))).toBe(1);
    expect(protectionThreshold(expiresAt, new Date(expiresAt.getTime() - 10 * DAY))).toBeNull();
    expect(protectionThreshold(expiresAt, new Date(expiresAt.getTime() + 1))).toBeNull();
  });

  it("only asks the database for open leads of active partners", async () => {
    mocks.leadFindMany.mockResolvedValue([]);
    await runSalesLeadReminders(now);
    for (const [args] of mocks.leadFindMany.mock.calls) {
      expect(args.where.salesPartner).toEqual({ is: { status: "ACTIVE" } });
      expect(args.where.status.notIn).toEqual(expect.arrayContaining(["CONVERTED", "LOST", "CANCELLED", "CONVERSION_REQUESTED"]));
    }
    expect(mocks.notificationFindMany).not.toHaveBeenCalled();
  });
});
