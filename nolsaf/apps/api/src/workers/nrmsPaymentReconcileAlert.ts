import { prisma } from "@nolsaf/prisma";
import { notifyAdmins, notifyOwner } from "../lib/notifications.js";
import { evaluateNrmsDunning } from "../lib/nrmsDunning.js";
import { sendMail } from "../lib/mailer.js";
import { proEmail } from "../lib/emailBase.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;

/** Methods whose provider prompt expires in minutes. Everything else is a slow rail. */
const FAST_METHODS = new Set(["MNO"]);

/**
 * Watchdog for NRMS balance payments stuck in PROCESSING.
 *
 * Two jobs, on different clocks:
 *
 * 1. Abandonment revert. A mobile-money prompt expires after a short countdown.
 *    An owner who never entered the PIN is not "pending", they simply have not
 *    paid, so the account returns to its true state within minutes and they can
 *    pay again at once. Card and bank rails get a longer window because a slow
 *    3-D Secure or bank confirmation is normal. The token is left untouched so
 *    a late provider verdict still settles through the normal idempotent path.
 *
 * 2. Reconcile alert. Past the alert threshold with still no verdict, admins
 *    get the urgent popup and the owner is told directly, in-app and by email,
 *    that NoLSAF is verifying, so a paid owner is never left staring at a
 *    pending card wondering where the money went. One alert per token, ever,
 *    deduped by the admin notification row.
 */
export async function runNrmsPaymentReconcileAlert(now = new Date()): Promise<{ checked: number; reverted: number; alerted: number }> {
  const alertAfterMs = Math.max(60_000, Number(process.env.NRMS_RECONCILE_ALERT_AFTER_MS || 10 * 60_000));
  const fastRevertMs = Math.max(60_000, Number(process.env.NRMS_PENDING_REVERT_FAST_MS || 6 * 60_000));
  const slowRevertMs = Math.max(fastRevertMs, Number(process.env.NRMS_PENDING_REVERT_SLOW_MS || 30 * 60_000));

  const tokens = await db.nrmsServicePaymentToken.findMany({
    where: { status: "PROCESSING", payment: null, statement: { status: "PAYABLE" } },
    include: { statement: { include: { account: { include: { policy: true, property: { select: { title: true } } } } } } },
    take: 100,
  });
  if (!tokens.length) return { checked: 0, reverted: 0, alerted: 0 };

  // Initiation time lives on the paymentEvent written when the owner chose a
  // method. token.createdAt is when the statement minted the token, which can
  // be days earlier, so it is only the fallback.
  const events = await db.paymentEvent.findMany({
    where: { createdAt: { gt: new Date(now.getTime() - 48 * 60 * 60 * 1000) }, payload: { not: null } },
    select: { createdAt: true, payload: true },
    orderBy: { id: "asc" },
    take: 1000,
  });
  const initiatedAt = new Map<string, Date>();
  for (const event of events) {
    const payload = event?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const value = (payload as any).nrmsToken ?? (payload as any).paymentRef;
    if (typeof value !== "string" || !value.startsWith("NRMS-")) continue;
    if (!initiatedAt.has(value)) initiatedAt.set(value, event.createdAt);
  }

  let reverted = 0;
  let alerted = 0;
  for (const token of tokens) {
    const startedAt = initiatedAt.get(token.token) ?? token.createdAt;
    const waitedMs = now.getTime() - new Date(startedAt).getTime();
    const account = token.statement.account;

    const revertAfterMs = FAST_METHODS.has(String(token.method || "").toUpperCase()) ? fastRevertMs : slowRevertMs;
    if (waitedMs >= revertAfterMs && account.status === "PAYMENT_PENDING") {
      const dunning = evaluateNrmsDunning({ balance: Number(account.unpaidBalance), reminderAmount: Number(account.policy.reminderAmount), warningAmount: Number(account.policy.warningAmount), unpaidLimit: Number(account.unpaidLimit), graceDays: account.policy.graceDays, limitReachedAt: account.limitReachedAt, trialEndsAt: account.trialEndsAt, now });
      await db.ownerPaygAccount.update({ where: { id: account.id }, data: { status: dunning.status, limitReachedAt: dunning.limitReachedAt } });
      reverted += 1;
    }

    if (waitedMs < alertAfterMs) continue;
    const existing = await db.notification.findFirst({
      where: { userId: null, ownerId: null, meta: { path: "$.nrmsToken", equals: token.token } },
      select: { id: true },
    });
    if (existing) continue;

    const propertyTitle = account.property?.title ?? "an NRMS property";
    const amountText = `${Number(token.amount).toLocaleString()} ${token.currency}`;
    const waitedMinutes = Math.floor(waitedMs / 60_000);
    await notifyAdmins("nrms_payment_reconcile_needed", {
      nrmsToken: token.token, propertyTitle, amount: Number(token.amount), currency: token.currency,
      method: token.method ?? "UNKNOWN", waitedMinutes,
    });
    await notifyOwner(account.ownerId, "nrms_payment_unconfirmed", { propertyTitle, amount: Number(token.amount), currency: token.currency });
    try {
      const owner = await db.user.findUnique({ where: { id: account.ownerId }, select: { email: true } });
      if (owner?.email) {
        await sendMail(
          owner.email,
          `Your NRMS payment for ${propertyTitle} is being verified`,
          proEmail(
            "We are checking your payment",
            `<p>A payment of <b>${amountText}</b> for <b>${propertyTitle}</b> has not been confirmed by the provider yet.</p>
             <p>If you completed it, you do not need to do anything. NoLSAF has been alerted and your account will update as soon as it is verified. Do not pay again.</p>
             <p>If you did not complete the prompt, your account will reopen for payment shortly and you can pay again from the NRMS billing page.</p>`,
          ),
        );
      }
    } catch (emailError) {
      console.error("[nrms-payment-reconcile-alert] owner email failed", emailError);
    }
    alerted += 1;
  }
  return { checked: tokens.length, reverted, alerted };
}

export function startNrmsPaymentReconcileAlertWorker(): void {
  const intervalMs = Math.max(60_000, Number(process.env.NRMS_RECONCILE_ALERT_INTERVAL_MS || 5 * 60_000));
  const run = () => runNrmsWorker("payment-reconcile-alert", () => runNrmsPaymentReconcileAlert()).catch((error) => console.error("[nrms-payment-reconcile-alert] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-payment-reconcile-alert] Started, interval: ${intervalMs / 1000}s`);
}
