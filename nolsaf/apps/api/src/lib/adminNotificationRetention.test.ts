import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { purgeSettledAdminNotifications } from "./adminNotificationRetention.js";

const NOW = new Date("2026-11-11T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("purgeSettledAdminNotifications", () => {
  it("looks only in the admin inbox and deletes only what the rules allow", async () => {
    const candidates = [
      { id: 1, unread: false, readAt: daysAgo(9), resolvedAt: null, requiresAction: false, type: "property", meta: { notificationKind: "property_approved" } },
      { id: 2, unread: false, readAt: daysAgo(20), resolvedAt: null, requiresAction: false, type: "invoice", meta: { notificationKind: "payment_unmatched" } },
      { id: 3, unread: false, readAt: daysAgo(20), resolvedAt: daysAgo(8), requiresAction: true, type: "invoice", meta: { notificationKind: "payout_disbursement_failed" } },
    ];
    const client: any = {
      notification: {
        findMany: vi.fn().mockResolvedValueOnce(candidates).mockResolvedValue([]),
        deleteMany: vi.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
    };
    expect(await purgeSettledAdminNotifications(NOW, client)).toEqual({ deleted: 2 });

    const where = client.notification.findMany.mock.calls[0][0].where;
    expect(where.unread).toBe(false);
    expect(where.AND[0]).toEqual({ OR: [{ userId: null, ownerId: null }, { ownerId: null, user: { is: { role: "ADMIN" } } }] });
    // An old unmatched payment that was only read, never resolved, stays.
    expect(client.notification.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 3] }, unread: false } });
  });

  it("deletes nothing when nothing has settled long enough", async () => {
    const client: any = { notification: { findMany: vi.fn(async () => []), deleteMany: vi.fn() } };
    expect(await purgeSettledAdminNotifications(NOW, client)).toEqual({ deleted: 0 });
    expect(client.notification.deleteMany).not.toHaveBeenCalled();
  });
});
