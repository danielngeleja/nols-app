import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { notifyOwner } from "../lib/notifications.js";
import { evaluateNrmsDunning } from "../lib/nrmsDunning.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;

export async function runNrmsDunning(now = new Date()) {
  const accounts = await db.ownerPaygAccount.findMany({
    where: { status: { notIn: ["CLOSED", "FROZEN"] }, unpaidBalance: { gt: 0 } },
    include: { policy: true, property: { select: { title: true } } },
  });
  let changed = 0;
  for (const account of accounts) {
    const dunning = evaluateNrmsDunning({ balance: Number(account.unpaidBalance), reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, limitReachedAt: account.limitReachedAt, trialEndsAt: account.trialEndsAt, currentStatus: account.status, now });
    const data: Record<string, unknown> = { status: dunning.status, limitReachedAt: dunning.limitReachedAt };
    let template: string | null = null;
    if (dunning.stage === "REMINDER" && !account.reminderNotifiedAt) { data.reminderNotifiedAt = now; template = "nrms_balance_reminder"; }
    if (["WARNING", "GRACE"].includes(dunning.stage) && !account.warningNotifiedAt) { data.warningNotifiedAt = now; template = "nrms_balance_warning"; }
    if (dunning.stage === "PAYMENT_REQUIRED" && !account.freezeNotifiedAt) { data.freezeNotifiedAt = now; template = "nrms_payment_required"; }
    if (dunning.stage === "CURRENT") Object.assign(data, { reminderNotifiedAt: null, warningNotifiedAt: null, freezeNotifiedAt: null });
    await db.ownerPaygAccount.update({ where: { id: account.id }, data });
    if (dunning.stage === "PAYMENT_REQUIRED") {
      await db.$transaction(async (tx: any) => {
        const existing = await tx.nrmsBillingStatement.findFirst({ where: { accountId: account.id, status: "PAYABLE" } });
        if (existing) return;
        const events = await tx.nrmsUsageEvent.findMany({ where: { accountId: account.id, amount: { gt: 0 }, statementItem: null }, select: { id: true, amount: true } });
        if (!events.length) return;
        const amount = events.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
        const statement = await tx.nrmsBillingStatement.create({ data: { accountId: account.id, amount, currency: account.policy.currency } });
        await tx.nrmsBillingStatementItem.createMany({ data: events.map((row: any) => ({ statementId: statement.id, usageEventId: row.id, amount: row.amount })) });
        await tx.nrmsServicePaymentToken.create({ data: { statementId: statement.id, token: `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`, amount, currency: account.policy.currency, expiresAt: new Date(now.getTime() + 7 * 86400000) } });
      });
    }
    if (template) await notifyOwner(account.ownerId, template, { propertyTitle: account.property.title, unpaidBalance: Number(account.unpaidBalance), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, freezeAt: dunning.freezeAt?.toISOString() ?? null });
    changed += 1;
  }
  return { accounts: accounts.length, changed };
}

export function startNrmsDunningWorker() {
  const intervalMs = Math.max(15 * 60_000, Number(process.env.NRMS_DUNNING_INTERVAL_MS || 60 * 60_000));
  const run = () => runNrmsWorker("dunning", () => runNrmsDunning()).catch((error) => console.error("[nrms-dunning] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-dunning] Started, interval: ${intervalMs / 1000}s`);
}
