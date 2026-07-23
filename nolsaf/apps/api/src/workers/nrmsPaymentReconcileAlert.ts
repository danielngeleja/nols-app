import { prisma } from "@nolsaf/prisma";
import { notifyAdmins } from "../lib/notifications.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;

/**
 * Early-warning alert for unresolved NRMS balance payments.
 *
 * A token sitting in PROCESSING means an owner initiated a payment and no
 * provider verdict has settled it. Ten minutes with no verdict is either an
 * abandoned prompt or a lost callback, and the server cannot tell which, so
 * the alert asks admins to verify with the provider before acting. This exists
 * because the reconciliation queue is pull-only: without a push, a real
 * paid-but-unrecorded payment waits for someone to happen to open the page.
 *
 * One alert per token, ever. Dedupe is the notification row itself, keyed by
 * the token stored in meta, so no schema change and no repeat alarms from
 * later sweeps.
 */
export async function runNrmsPaymentReconcileAlert(now = new Date()): Promise<{ checked: number; alerted: number }> {
  const alertAfterMs = Math.max(60_000, Number(process.env.NRMS_RECONCILE_ALERT_AFTER_MS || 10 * 60_000));
  const tokens = await db.nrmsServicePaymentToken.findMany({
    where: { status: "PROCESSING", payment: null, statement: { status: "PAYABLE" } },
    include: { statement: { include: { account: { include: { property: { select: { title: true } } } } } } },
    take: 100,
  });
  if (!tokens.length) return { checked: 0, alerted: 0 };

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

  let alerted = 0;
  for (const token of tokens) {
    const startedAt = initiatedAt.get(token.token) ?? token.createdAt;
    const waitedMs = now.getTime() - new Date(startedAt).getTime();
    if (waitedMs < alertAfterMs) continue;
    const existing = await db.notification.findFirst({
      where: { userId: null, ownerId: null, meta: { path: "$.nrmsToken", equals: token.token } },
      select: { id: true },
    });
    if (existing) continue;
    await notifyAdmins("nrms_payment_reconcile_needed", {
      nrmsToken: token.token,
      propertyTitle: token.statement.account.property?.title ?? "an NRMS property",
      amount: Number(token.amount),
      currency: token.currency,
      method: token.method ?? "UNKNOWN",
      waitedMinutes: Math.floor(waitedMs / 60_000),
    });
    alerted += 1;
  }
  return { checked: tokens.length, alerted };
}

export function startNrmsPaymentReconcileAlertWorker(): void {
  const intervalMs = Math.max(60_000, Number(process.env.NRMS_RECONCILE_ALERT_INTERVAL_MS || 5 * 60_000));
  const run = () => runNrmsWorker("payment-reconcile-alert", () => runNrmsPaymentReconcileAlert()).catch((error) => console.error("[nrms-payment-reconcile-alert] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-payment-reconcile-alert] Started, interval: ${intervalMs / 1000}s`);
}
