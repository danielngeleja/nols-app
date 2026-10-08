import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), notifyAdmins: vi.fn() }));
vi.mock("@nolsaf/prisma", () => ({ prisma: { guestCodeRequest: { findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: mocks.notifyAdmins }));

import { remindOverdueGuestCodeRequests } from "./guestCodeRequestReminders.js";

const NOW = new Date("2026-10-09T10:00:00Z");

describe("guest code request reminders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reminds admins once for a request open past 30 minutes", async () => {
    mocks.findMany.mockResolvedValue([{ id: 7, bookingId: 41, createdAt: new Date("2026-10-09T09:20:00Z"), booking: { property: { title: "Jamirex Hotel" } } }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await expect(remindOverdueGuestCodeRequests(NOW)).resolves.toEqual({ reminded: 1 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ remindedAt: null, createdAt: { lte: new Date("2026-10-09T09:30:00Z") } }),
    }));
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("booking_guest_code_overdue", expect.objectContaining({ propertyTitle: "Jamirex Hotel", minutesOpen: 40 }));
  });

  it("skips a request another instance already claimed", async () => {
    mocks.findMany.mockResolvedValue([{ id: 7, bookingId: 41, createdAt: new Date("2026-10-09T09:20:00Z"), booking: null }]);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(remindOverdueGuestCodeRequests(NOW)).resolves.toEqual({ reminded: 0 });
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("does nothing before the table exists", async () => {
    mocks.findMany.mockRejectedValue(new Error("The table `guest_code_request` does not exist"));
    await expect(remindOverdueGuestCodeRequests(NOW)).resolves.toEqual({ reminded: 0 });
  });
});
