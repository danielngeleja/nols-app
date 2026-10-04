// apps/api/src/workers/salesLeadReminders.ts
// Nudges sales partners about their own pipeline:
//   1. a follow-up date they set has arrived;
//   2. their claim protection on a lead is about to lapse (7 days, then 1 day).
//
// There is no "reminded" column on SalesLead, so the notification itself is the
// record: each reminder carries a dedupeKey in its meta, and a key already sent
// is never sent again. Rescheduling a follow-up or extending protection creates
// a new key, so the partner is reminded about the new date too. Workers run on
// one leader process (see leaderLock.ts), so two sends cannot race.
import { prisma } from "@nolsaf/prisma";
import { notifyUser } from "../lib/notifications.js";
import { CLOSED_LEAD_STATUSES } from "../lib/salesPartner.js";

const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Leads still in the partner's hands. A conversion under admin review is not. */
const EXCLUDED_STATUSES = [...CLOSED_LEAD_STATUSES, "CONVERSION_REQUESTED"];
/** Do not dig up follow-ups older than this on the first run after deploy. */
const FOLLOW_UP_LOOKBACK_DAYS = 30;
/** Protection reminders fire at these days-remaining thresholds. */
const PROTECTION_THRESHOLDS = [7, 1] as const;
const BATCH = 300;

type Reminder = {
  userId: number;
  template: "sales_partner_lead_followup" | "sales_partner_lead_protection_expiring";
  dedupeKey: string;
  data: Record<string, unknown>;
};

export function followUpKey(leadId: number, due: Date) {
  return `lead-followup:${leadId}:${due.toISOString()}`;
}

export function protectionKey(leadId: number, expiresAt: Date, threshold: number) {
  return `lead-protection:${leadId}:${expiresAt.toISOString()}:${threshold}`;
}

/** The narrowest threshold the remaining time falls under, or null if none yet. */
export function protectionThreshold(expiresAt: Date, now: Date): number | null {
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  const daysRemaining = remainingMs / DAY_MS;
  let hit: number | null = null;
  for (const t of PROTECTION_THRESHOLDS) if (daysRemaining <= t) hit = t;
  return hit;
}

export async function runSalesLeadReminders(now = new Date()): Promise<{ followUps: number; protection: number }> {
  const openLead = {
    status: { notIn: EXCLUDED_STATUSES },
    salesPartner: { is: { status: "ACTIVE" } },
  };
  const select = {
    id: true,
    propertyName: true,
    nextFollowUpAt: true,
    protectionExpiresAt: true,
    salesPartner: { select: { userId: true } },
  };

  const [dueFollowUps, expiringClaims] = await Promise.all([
    db.salesLead.findMany({
      where: {
        ...openLead,
        nextFollowUpAt: { lte: now, gte: new Date(now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * DAY_MS) },
      },
      orderBy: { nextFollowUpAt: "asc" },
      take: BATCH,
      select,
    }),
    db.salesLead.findMany({
      where: {
        ...openLead,
        protectionExpiresAt: { gt: now, lte: new Date(now.getTime() + PROTECTION_THRESHOLDS[0] * DAY_MS) },
      },
      orderBy: { protectionExpiresAt: "asc" },
      take: BATCH,
      select,
    }),
  ]);

  const candidates: Reminder[] = [];
  for (const lead of dueFollowUps) {
    const userId = Number(lead.salesPartner?.userId);
    if (!userId || !lead.nextFollowUpAt) continue;
    const due = new Date(lead.nextFollowUpAt);
    candidates.push({
      userId,
      template: "sales_partner_lead_followup",
      dedupeKey: followUpKey(lead.id, due),
      data: { leadId: lead.id, propertyName: lead.propertyName, nextFollowUpAt: due.toISOString() },
    });
  }
  for (const lead of expiringClaims) {
    const userId = Number(lead.salesPartner?.userId);
    if (!userId || !lead.protectionExpiresAt) continue;
    const expiresAt = new Date(lead.protectionExpiresAt);
    const threshold = protectionThreshold(expiresAt, now);
    if (threshold == null) continue;
    candidates.push({
      userId,
      template: "sales_partner_lead_protection_expiring",
      dedupeKey: protectionKey(lead.id, expiresAt, threshold),
      data: {
        leadId: lead.id,
        propertyName: lead.propertyName,
        protectionExpiresAt: expiresAt.toISOString(),
        daysRemaining: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS)),
      },
    });
  }
  if (!candidates.length) return { followUps: 0, protection: 0 };

  // Which of these were already sent. Keys only ever refer to dates within the
  // last FOLLOW_UP_LOOKBACK_DAYS or the protection window, so a bounded look
  // back over this partner set's sales notifications is enough.
  const userIds = [...new Set(candidates.map((c) => c.userId))];
  const sent = await db.notification.findMany({
    where: {
      userId: { in: userIds },
      type: "sales",
      createdAt: { gte: new Date(now.getTime() - (FOLLOW_UP_LOOKBACK_DAYS + 10) * DAY_MS) },
    },
    select: { meta: true },
  });
  const sentKeys = new Set<string>(
    sent.map((row: any) => row?.meta?.dedupeKey).filter((key: unknown): key is string => typeof key === "string"),
  );

  let followUps = 0;
  let protection = 0;
  for (const reminder of candidates) {
    if (sentKeys.has(reminder.dedupeKey)) continue;
    sentKeys.add(reminder.dedupeKey);
    await notifyUser(reminder.userId, reminder.template, {
      ...reminder.data,
      dedupeKey: reminder.dedupeKey,
      actionPath: `/sales/leads/${reminder.data.leadId}`,
    });
    if (reminder.template === "sales_partner_lead_followup") followUps += 1;
    else protection += 1;
  }
  return { followUps, protection };
}

export function startSalesLeadReminderWorker(): void {
  const intervalMs = Math.max(60_000, Number(process.env.SALES_LEAD_REMINDER_INTERVAL_MS || 30 * 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runSalesLeadReminders();
      if (result.followUps || result.protection) console.log("[sales-lead-reminders] sent", result);
    } catch (error: any) {
      console.error("[sales-lead-reminders] Worker failed:", error?.message || error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  console.log(`[sales-lead-reminders] Started, interval: ${intervalMs / 1000}s`);
}
