import { prisma } from "@nolsaf/prisma";
import { sendSms } from "../lib/sms.js";

const DEFAULT_INTERVAL_MS = 15_000;
const BATCH_SIZE = 20;

async function finishWithoutDelivery(
  recipient: { id: number; campaign: { ownerId: number }; normalizedPhone: string; quotaYear: number | null },
  data: { status: "SKIPPED" | "FAILED"; skipReason?: string; provider?: string; errorMessage?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.guestSmsCampaignRecipient.update({ where: { id: recipient.id }, data });
    if (recipient.quotaYear) {
      await tx.guestSmsAnnualQuota.updateMany({
        where: {
          ownerId: recipient.campaign.ownerId,
          normalizedPhone: recipient.normalizedPhone,
          year: recipient.quotaYear,
          usedCount: { gt: 0 },
        },
        data: { usedCount: { decrement: 1 } },
      });
    }
  });
}

async function refreshCampaign(campaignId: number): Promise<void> {
  const grouped = await prisma.guestSmsCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const campaign = await prisma.guestSmsCampaign.findUnique({ where: { id: campaignId }, select: { totalCount: true } });
  const counts = new Map<string, number>(grouped.map((row) => [row.status, row._count._all]));
  const queued = (counts.get("QUEUED") ?? 0) + (counts.get("SENDING") ?? 0);
  const sentCount = counts.get("SENT") ?? 0;
  const failedCount = counts.get("FAILED") ?? 0;
  const recordedCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const skippedCount = (counts.get("SKIPPED") ?? 0) + Math.max(0, (campaign?.totalCount ?? recordedCount) - recordedCount);
  const status = queued > 0
    ? "SENDING"
    : failedCount > 0 && sentCount === 0
      ? "FAILED"
      : failedCount > 0
        ? "PARTIAL"
        : "COMPLETED";
  await prisma.guestSmsCampaign.update({
    where: { id: campaignId },
    data: {
      status,
      sentCount,
      failedCount,
      skippedCount,
      completedAt: queued === 0 ? new Date() : null,
    },
  });
}

export async function processGuestSmsCampaignBatch(): Promise<number> {
  const queued = await prisma.guestSmsCampaignRecipient.findMany({
    where: { status: "QUEUED", campaign: { status: { in: ["QUEUED", "SENDING"] } } },
    include: { campaign: { select: { id: true, ownerId: true, message: true } } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  const touchedCampaigns = new Set<number>();

  for (const recipient of queued) {
    const claimed = await prisma.guestSmsCampaignRecipient.updateMany({
      where: { id: recipient.id, status: "QUEUED" },
      data: { status: "SENDING", errorMessage: null },
    });
    if (claimed.count !== 1) continue;
    touchedCampaigns.add(recipient.campaignId);

    try {
      const preference = await prisma.guestSmsPreference.findUnique({
        where: {
          ownerId_normalizedPhone: {
            ownerId: recipient.campaign.ownerId,
            normalizedPhone: recipient.normalizedPhone,
          },
        },
        select: { status: true },
      });
      if (preference?.status !== "OPTED_IN") {
        await finishWithoutDelivery(recipient, { status: "SKIPPED", skipReason: "CONSENT_REVOKED" });
        continue;
      }

      const result = await sendSms(recipient.normalizedPhone, recipient.campaign.message, { provider: "africastalking" });
      if (result.success && result.provider !== "suppressed") {
        await prisma.guestSmsCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            provider: result.provider ?? null,
            providerMessageId: result.messageId ?? null,
            sentAt: new Date(),
          },
        });
      } else if (result.provider === "suppressed") {
        await finishWithoutDelivery(recipient, { status: "SKIPPED", skipReason: "NOTIFICATION_BLOCKED", provider: result.provider });
      } else {
        await finishWithoutDelivery(recipient, {
          status: "FAILED",
          errorMessage: String(result.error ?? "Provider rejected the message").slice(0, 500),
        });
      }
    } catch (error) {
      await finishWithoutDelivery(recipient, {
        status: "FAILED",
        errorMessage: String(error instanceof Error ? error.message : error).slice(0, 500),
      });
    }
  }

  for (const campaignId of touchedCampaigns) await refreshCampaign(campaignId);
  return queued.length;
}

export function startGuestSmsCampaignWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processGuestSmsCampaignBatch();
    } catch (error) {
      console.error("[guest-sms-campaigns] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[guest-sms-campaigns] Started — interval: ${intervalMs / 1000}s`);
}
