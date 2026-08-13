import { prisma } from "@nolsaf/prisma";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;
const DAY_MS = 86400000;
export const NRMS_GUEST_RETENTION_DAYS = 730;
export const NRMS_OPERATIONAL_RETENTION_DAYS = 2555;

export async function runNrmsRetention(now = new Date()) {
  const accounts = await db.ownerPaygAccount.findMany({ where: { retentionClosedAt: { not: null } }, select: { id: true, propertyId: true, retentionClosedAt: true, guestDataAnonymizedAt: true, operationalDataMinimizedAt: true } });
  let guestProfiles = 0;
  let propertiesMinimized = 0;
  for (const account of accounts) {
    const closedAt = new Date(account.retentionClosedAt);
    if (!account.guestDataAnonymizedAt && now.getTime() >= closedAt.getTime() + NRMS_GUEST_RETENTION_DAYS * DAY_MS) {
      const profiles = await db.guestProfile.findMany({ where: { propertyId: account.propertyId }, select: { id: true } });
      for (const profile of profiles) {
        await db.guestProfile.update({ where: { id: profile.id }, data: { fullName: `Former guest #${profile.id}`, phone: null, email: null, nationality: null, notes: null } });
      }
      const recipients = await db.guestSmsCampaignRecipient.findMany({ where: { campaign: { propertyId: account.propertyId } }, select: { id: true } });
      for (const recipient of recipients) {
        await db.guestSmsCampaignRecipient.update({ where: { id: recipient.id }, data: { normalizedPhone: `redacted-${recipient.id}`, guestName: "Former guest", errorMessage: null } });
      }
      await db.ownerPaygAccount.update({ where: { id: account.id }, data: { guestDataAnonymizedAt: now } });
      guestProfiles += profiles.length;
    }
    if (!account.operationalDataMinimizedAt && now.getTime() >= closedAt.getTime() + NRMS_OPERATIONAL_RETENTION_DAYS * DAY_MS) {
      await db.$transaction([
        db.reservation.updateMany({ where: { propertyId: account.propertyId }, data: { externalRef: null, cancelReason: null, notes: null } }),
        db.externalPaymentRecord.updateMany({ where: { reservation: { propertyId: account.propertyId } }, data: { reference: null, note: null, voidReason: null } }),
        db.reservationCharge.updateMany({ where: { reservation: { propertyId: account.propertyId } }, data: { description: null, voidReason: null } }),
        db.nrmsOutletOrder.updateMany({ where: { propertyId: account.propertyId }, data: { customerLabel: null, note: null, guestFeedback: null, voidReason: null } }),
        db.ownerPaygAccount.update({ where: { id: account.id }, data: { operationalDataMinimizedAt: now } }),
      ]);
      propertiesMinimized += 1;
    }
  }
  return { accounts: accounts.length, guestProfiles, propertiesMinimized };
}

export function startNrmsRetentionWorker() {
  const intervalMs = Math.max(60 * 60_000, Number(process.env.NRMS_RETENTION_INTERVAL_MS || 24 * 60 * 60_000));
  const run = () => runNrmsWorker("retention", () => runNrmsRetention()).catch((error) => console.error("[nrms-retention] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-retention] Started, interval: ${intervalMs / 1000}s`);
}
