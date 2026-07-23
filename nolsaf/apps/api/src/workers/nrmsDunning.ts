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
    // PAYMENT_PENDING is sticky in the evaluator because a decided payment must
    // not be re-dunned while the provider confirms it. But if the provider never
    // calls back at all, the pending attempt eventually expires and nothing else
    // resolves the account: it would block new external stays forever. When no
    // live attempt remains, expire the stale tokens and let the balance decide.
    let currentStatus: string | null = account.status;
    if (currentStatus === "PAYMENT_PENDING") {
      const liveAttempt = await db.nrmsServicePaymentToken.findFirst({
        where: { statement: { accountId: account.id, status: "PAYABLE" }, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { gt: now }, payment: null },
        select: { id: true },
      });
      if (!liveAttempt) {
        await db.nrmsServicePaymentToken.updateMany({
          where: { statement: { accountId: account.id }, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        currentStatus = null;
      }
    }
    const dunning = evaluateNrmsDunning({ balance: Number(account.unpaidBalance), reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, limitReachedAt: account.limitReachedAt, trialEndsAt: account.trialEndsAt, currentStatus, now });
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
