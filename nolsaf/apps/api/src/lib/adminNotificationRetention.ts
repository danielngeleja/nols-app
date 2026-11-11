// apps/api/src/lib/adminNotificationRetention.ts
//
// Clears admin alerts that are both read and resolved, 7 days after they were
// settled (lib/adminNotificationKinds.ts). Unread alerts, and alerts that ask
// for action and are not resolved, are never removed. Only the admin inbox is
// touched: platform rows (no recipient) and rows addressed to admin accounts.
// Owner, operator, driver and traveller inboxes are left alone.

import { prisma } from "@nolsaf/prisma";
import { ADMIN_NOTIFICATION_RETENTION_DAYS, adminNotificationExpired } from "./adminNotificationKinds.js";
import { sweepAutoSettle } from "./adminNotificationSettle.js";

const db = prisma as any;
const BATCH = 500;
const HOUR_MS = 60 * 60 * 1000;

export const ADMIN_INBOX_WHERE = {
  OR: [{ userId: null, ownerId: null }, { ownerId: null, user: { is: { role: "ADMIN" } } }],
};

export async function purgeSettledAdminNotifications(now = new Date(), client: any = db): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - ADMIN_NOTIFICATION_RETENTION_DAYS * 24 * HOUR_MS);
  let deleted = 0;
  let cursor = 0;
  for (;;) {
    // Candidates by date only; the kind rules are applied row by row below, so
    // an older row without the new columns is still judged by its kind.
    const rows = await client.notification.findMany({
      where: {
        AND: [
          ADMIN_INBOX_WHERE,
          { OR: [{ resolvedAt: { lte: cutoff } }, { resolvedAt: null, readAt: { lte: cutoff } }] },
        ],
        id: { gt: cursor },
        unread: false,
      },
      select: { id: true, unread: true, readAt: true, resolvedAt: true, requiresAction: true, type: true, meta: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    const ids = rows.filter((row: any) => adminNotificationExpired(row, now)).map((row: any) => row.id);
    if (ids.length) {
      // Guarded again in the delete itself: never remove something that became unread.
      const result = await client.notification.deleteMany({ where: { id: { in: ids }, unread: false } });
      deleted += result.count;
    }
    if (rows.length < BATCH) break;
  }
  return { deleted };
}

export function startAdminNotificationRetentionWorker(): void {
  const run = () =>
    sweepAutoSettle()
      .then(({ settled }) => { if (settled) console.log(`[admin-notifications] closed ${settled} alert(s) already decided elsewhere`); })
      .catch((error: any) => console.error("[admin-notifications] auto-settle failed:", error?.message || error))
      .then(() => purgeSettledAdminNotifications())
      .then(({ deleted }) => { if (deleted) console.log(`[admin-notifications] cleared ${deleted} read and resolved alert(s) older than ${ADMIN_NOTIFICATION_RETENTION_DAYS} days`); })
      .catch((error: any) => console.error("[admin-notifications] retention failed:", error?.message || error));
  void run();
  const timer = setInterval(() => void run(), HOUR_MS);
  timer.unref?.();
}
