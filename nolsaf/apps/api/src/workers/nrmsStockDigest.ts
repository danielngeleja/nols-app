// Owner stock digest (docs/NRMS_STOCK_AND_PURCHASING.md section 7.6,
// milestone 6). Hourly tick; for each property whose owner switched the digest
// on, post it once a day (or once a week) after 07:00 EAT as an in-app
// notification. Off by default. SMS and WhatsApp delivery wait for approved
// message templates; the wording here is fixed by buildDigest, never free text.

import { prisma } from "@nolsaf/prisma";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";
import { computeStockDigest } from "../lib/nrmsStockDigest.js";
import { digestDue } from "../lib/nrmsStockInsights.js";

const db = prisma as any;

export async function sendDueStockDigests(now = new Date()) {
  const settings = await db.nrmsStockSettings.findMany({
    where: { digestFrequency: { in: ["DAILY", "WEEKLY"] } },
    select: { propertyId: true, digestFrequency: true, digestLastSentAt: true, property: { select: { id: true, title: true, ownerId: true, currency: true } } },
  });
  let sent = 0;
  for (const row of settings) {
    if (!row.property?.ownerId || !digestDue({ frequency: row.digestFrequency, lastSentAt: row.digestLastSentAt, now })) continue;
    // Claim the send first so two ticks, or two instances, never post it twice.
    const claimed = await db.nrmsStockSettings.updateMany({
      where: { propertyId: row.propertyId, digestLastSentAt: row.digestLastSentAt ?? null },
      data: { digestLastSentAt: now },
    });
    if (claimed.count !== 1) continue;
    try {
      const since = row.digestLastSentAt ?? new Date(now.getTime() - (row.digestFrequency === "WEEKLY" ? 7 : 1) * 86_400_000);
      const digest = await computeStockDigest(row.propertyId, since, row.property.currency || "TZS");
      await db.notification.create({
        data: {
          ownerId: row.property.ownerId,
          userId: row.property.ownerId,
          title: `Stock ${row.digestFrequency === "WEEKLY" ? "weekly" : "daily"} digest, ${row.property.title}`.slice(0, 200),
          body: [digest.headline, ...digest.lines.map((line) => `- ${line.text}`)].join("\n"),
          type: "nrms_stock_digest",
          meta: { kind: "NRMS_STOCK_DIGEST", propertyId: row.propertyId, link: "/owner/nrms/stock/insights", lines: digest.lines.length },
        },
      });
      sent += 1;
    } catch (error) {
      // Give the slot back so the next tick tries again.
      await db.nrmsStockSettings.updateMany({ where: { propertyId: row.propertyId, digestLastSentAt: now }, data: { digestLastSentAt: row.digestLastSentAt ?? null } });
      console.error("[nrms-stock-digest] property failed", row.propertyId, error);
    }
  }
  return { candidates: settings.length, sent };
}

export function startNrmsStockDigestWorker() {
  const intervalMs = Math.max(15 * 60_000, Number(process.env.NRMS_STOCK_DIGEST_INTERVAL_MS || 60 * 60_000));
  const run = () => runNrmsWorker("stock-digest", () => sendDueStockDigests()).catch((error) => console.error("[nrms-stock-digest] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-stock-digest] Started, interval: ${intervalMs / 1000}s`);
}
