import { prisma } from "@nolsaf/prisma";
import { notifyAdmins } from "../lib/notifications.js";
import { customerBookingReference } from "../lib/customerBookingReference.js";
import { OPEN_GUEST_CODE_STATUSES } from "../lib/guestCodeRequests.js";

/**
 * A guest code request that the system could not send on its own (contacts
 * overlap, guest unreachable) may have a guest standing at the desk. Admins
 * are told when it arrives; this worker reminds them once more if it is still
 * open after the target time. The Action Center tracks the same request as a
 * work item with its own SLA and escalates it when overdue.
 */
export const GUEST_CODE_REMINDER_AFTER_MINUTES = 30;

const db = prisma as any;

export async function remindOverdueGuestCodeRequests(now = new Date()) {
  const cutoff = new Date(now.getTime() - GUEST_CODE_REMINDER_AFTER_MINUTES * 60 * 1000);
  let rows: any[];
  try {
    rows = await db.guestCodeRequest.findMany({
      where: { status: { in: OPEN_GUEST_CODE_STATUSES }, createdAt: { lte: cutoff }, remindedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true, bookingId: true, createdAt: true, booking: { select: { property: { select: { title: true } } } } },
    });
  } catch {
    // Table not created yet (migration pending): nothing to remind about.
    return { reminded: 0 };
  }

  let reminded = 0;
  for (const row of rows) {
    // Claim first so two instances never send the same reminder.
    const claimed = await db.guestCodeRequest.updateMany({
      where: { id: row.id, remindedAt: null, status: { in: OPEN_GUEST_CODE_STATUSES } },
      data: { remindedAt: now },
    });
    if (claimed.count !== 1) continue;
    await notifyAdmins("booking_guest_code_overdue", {
      bookingId: row.bookingId,
      bookingReference: customerBookingReference(row.bookingId),
      propertyTitle: row.booking?.property?.title ?? null,
      minutesOpen: Math.round((now.getTime() - new Date(row.createdAt).getTime()) / 60_000),
    });
    reminded += 1;
  }
  return { reminded };
}

export function startGuestCodeRequestReminders() {
  const intervalMs = 5 * 60_000;
  const run = () =>
    remindOverdueGuestCodeRequests().catch((error) => console.error("[guest-code-reminders] run failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[guest-code-reminders] Started, interval: ${intervalMs / 1000}s`);
}
