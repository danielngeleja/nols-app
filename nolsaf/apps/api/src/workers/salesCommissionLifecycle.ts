import { prisma } from "@nolsaf/prisma";
import {
  accrueMarketplaceSalesCommission,
  accrueNrmsSalesCommission,
} from "../lib/salesCommission.js";

const db = prisma as any;

export async function runSalesCommissionLifecycle(now = new Date()): Promise<{
  nrmsAccrued: number;
  marketplaceAccrued: number;
  madeEligible: number;
}> {
  // Reconcile recent paid sources as a safety net for transient failures,
  // rolling deployments and every alternate admin collection path. Source-key
  // uniqueness makes this safe to run repeatedly and on startup.
  const [statements, invoices] = await Promise.all([
    db.nrmsBillingStatement.findMany({
      where: { status: "PAID", paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      take: 1_000,
      select: { id: true },
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      take: 1_000,
      select: { id: true },
    }),
  ]);
  const statementIds = statements.map((row: any) => row.id);
  const invoiceIds = invoices.map((row: any) => row.id);
  const existing = statementIds.length || invoiceIds.length
    ? await db.salesCommission.findMany({
        where: {
          OR: [
            ...(statementIds.length ? [{ sourceStatementId: { in: statementIds } }] : []),
            ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
          ],
        },
        select: { sourceStatementId: true, sourceInvoiceId: true },
      })
    : [];
  const accruedStatementIds = new Set(
    existing.map((row: any) => row.sourceStatementId).filter((id: unknown) => Number.isInteger(id)),
  );
  const accruedInvoiceIds = new Set(
    existing.map((row: any) => row.sourceInvoiceId).filter((id: unknown) => Number.isInteger(id)),
  );

  let nrmsAccrued = 0;
  let marketplaceAccrued = 0;
  for (const statement of statements) {
    if (accruedStatementIds.has(statement.id)) continue;
    const result = await db.$transaction((tx: any) => accrueNrmsSalesCommission(tx, statement.id));
    if (result.created) nrmsAccrued += 1;
  }
  for (const invoice of invoices) {
    if (accruedInvoiceIds.has(invoice.id)) continue;
    const result = await db.$transaction((tx: any) => accrueMarketplaceSalesCommission(tx, invoice.id));
    if (result.created) marketplaceAccrued += 1;
  }

  const candidates = await db.salesCommission.findMany({
    where: { status: "VALIDATING", eligibleAt: { lte: now } },
    orderBy: { eligibleAt: "asc" },
    take: 500,
    select: { id: true, status: true, eligibleAt: true },
  });
  let madeEligible = 0;
  for (const candidate of candidates) {
    const changed = await db.$transaction(async (tx: any) => {
      const updated = await tx.salesCommission.updateMany({
        where: { id: candidate.id, status: "VALIDATING", eligibleAt: { lte: now } },
        data: { status: "ELIGIBLE" },
      });
      if (updated.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "SALES_COMMISSION_ELIGIBLE",
          entity: "SALES_COMMISSION",
          entityId: candidate.id,
          beforeJson: { status: candidate.status },
          afterJson: { status: "ELIGIBLE", eligibleAt: candidate.eligibleAt },
        },
      });
      return true;
    });
    if (changed) madeEligible += 1;
  }
  return { nrmsAccrued, marketplaceAccrued, madeEligible };
}

export function startSalesCommissionLifecycleWorker(): void {
  const intervalMs = Math.max(
    60_000,
    Number(process.env.SALES_COMMISSION_WORKER_INTERVAL_MS || 5 * 60_000),
  );
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runSalesCommissionLifecycle();
      if (result.nrmsAccrued || result.marketplaceAccrued || result.madeEligible) {
        console.log("[sales-commission] lifecycle", result);
      }
    } catch (error: any) {
      // During the rolling migration window the new tables may not exist yet.
      // Payments continue; the next run backfills idempotently after migration.
      console.error("[sales-commission] lifecycle failed:", error?.message || error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  console.log(`[sales-commission] Started, interval: ${intervalMs / 1000}s`);
}
