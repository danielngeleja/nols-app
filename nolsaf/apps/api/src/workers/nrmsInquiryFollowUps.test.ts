import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsGuestInquiry: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("../lib/notifications.js", () => ({ notifyUser: mocks.notifyUser }));

import { runNrmsInquiryFollowUps } from "./nrmsInquiryFollowUps.js";

describe("NRMS inquiry follow-up reminders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims and notifies the assigned staff member once", async () => {
    const now = new Date("2026-09-10T08:00:00.000Z");
    mocks.findMany.mockResolvedValue([{
      id: 12,
      assignedToId: 44,
      reference: "INQ-12",
      guestName: "Amina",
      nextFollowUpAt: new Date("2026-09-10T07:30:00.000Z"),
      property: { title: "Harbour Hotel" },
    }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(runNrmsInquiryFollowUps(now)).resolves.toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 12, followUpRemindedAt: null, nextFollowUpAt: { lte: now } },
      data: { followUpRemindedAt: now },
    });
    expect(mocks.notifyUser).toHaveBeenCalledWith(44, "nrms_inquiry_followup_due", expect.objectContaining({
      reference: "INQ-12",
      propertyTitle: "Harbour Hotel",
    }));
  });

  it("does not notify when another worker already claimed the reminder", async () => {
    mocks.findMany.mockResolvedValue([{
      id: 12,
      assignedToId: 44,
      reference: "INQ-12",
      guestName: null,
      nextFollowUpAt: new Date(),
      property: { title: "Hotel" },
    }]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(runNrmsInquiryFollowUps(new Date())).resolves.toBe(0);
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });
});
