import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findCode: vi.fn(), transaction: vi.fn(), claim: vi.fn(), updateBooking: vi.fn(), checkedIn: vi.fn() }));
vi.mock("@nolsaf/prisma", () => ({ prisma: { checkinCode: { findUnique: mocks.findCode }, $transaction: mocks.transaction } }));
vi.mock("./nolsafMarketplaceNrms.js", () => ({ updateNoLsafBookingStatus: mocks.updateBooking }));
vi.mock("../services/payouts/release.js", () => ({ onBookingCheckedIn: mocks.checkedIn }));
import { markBookingCodeAsUsed } from "./bookingCodeService.js";

describe("owner check-in requires the guest-held code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCode.mockResolvedValue({
      id: 7, status: "ACTIVE", bookingId: 42,
      codeHash: crypto.createHash("sha256").update("ABCD2345").digest("hex"),
      booking: { checkIn: new Date(), checkOut: new Date(Date.now() + 86400000), property: { ownerId: 9 } },
    });
    mocks.claim.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: any) => callback({ checkinCode: { updateMany: mocks.claim } }));
  });

  it("rejects a booking ID with no matching code without changing state", async () => {
    expect(await markBookingCodeAsUsed(7, 9, "WRONG234")).toMatchObject({ success: false });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.checkedIn).not.toHaveBeenCalled();
  });

  it("claims the active code and booking atomically", async () => {
    expect(await markBookingCodeAsUsed(7, 9, "abcd2345")).toEqual({ success: true });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 7, status: "ACTIVE", codeHash: expect.any(String) }),
    }));
    expect(mocks.updateBooking).toHaveBeenCalledWith(expect.anything(), 42, "CHECKED_IN");
    expect(mocks.checkedIn).toHaveBeenCalledWith(42);
  });
});
