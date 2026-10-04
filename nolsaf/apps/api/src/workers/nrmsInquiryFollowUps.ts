import { prisma } from "@nolsaf/prisma";
import { notifyUser } from "../lib/notifications.js";

const ACTIVE_STATUSES = ["NEW", "OPEN", "WAITING_GUEST"];

export async function runNrmsInquiryFollowUps(now = new Date()): Promise<number> {
  const due = await prisma.nrmsGuestInquiry.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      assignedToId: { not: null },
      nextFollowUpAt: { lte: now },
      followUpRemindedAt: null,
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: 200,
    select: {
      id: true,
      assignedToId: true,
      reference: true,
      guestName: true,
      nextFollowUpAt: true,
      property: { select: { title: true } },
    },
  });

  let notified = 0;
  for (const inquiry of due) {
    const claimed = await prisma.nrmsGuestInquiry.updateMany({
      where: { id: inquiry.id, followUpRemindedAt: null, nextFollowUpAt: { lte: now } },
      data: { followUpRemindedAt: now },
    });
    if (claimed.count !== 1 || !inquiry.assignedToId) continue;

    try {
      await notifyUser(inquiry.assignedToId, "nrms_inquiry_followup_due", {
        reference: inquiry.reference,
        guestName: inquiry.guestName,
        propertyTitle: inquiry.property.title,
        nextFollowUpAt: inquiry.nextFollowUpAt,
      });
      notified += 1;
    } catch (error) {
      await prisma.nrmsGuestInquiry.updateMany({
        where: { id: inquiry.id, followUpRemindedAt: now },
        data: { followUpRemindedAt: null },
      });
      throw error;
    }
  }
  return notified;
}

export function startNrmsInquiryFollowUpWorker(): void {
  const intervalMs = Math.max(60_000, Number(process.env.NRMS_INQUIRY_FOLLOW_UP_INTERVAL_MS || 5 * 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const notified = await runNrmsInquiryFollowUps();
      if (notified) console.log(`[nrms-inquiry-follow-ups] Sent ${notified} reminder(s)`);
    } catch (error: any) {
      console.error("[nrms-inquiry-follow-ups] Worker failed:", error?.message || error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  console.log(`[nrms-inquiry-follow-ups] Started, interval: ${intervalMs / 1000}s`);
}
