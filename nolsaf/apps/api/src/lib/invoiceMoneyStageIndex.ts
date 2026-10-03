import { prisma } from "@nolsaf/prisma";
import { MONEY_STAGES, moneyStageOf, type MoneyStage } from "./invoiceMoneyStage.js";

export type StageIndexEntry = { stage: MoneyStage; manual: boolean };
export type StageTotals = { stage: MoneyStage; label: string; count: number; total: number; netPayable: number; commission: number };
export type StageDisbursement = { status: string; paidAt: Date | null };

/** Stages in which the guest's money has reached NoLSAF. */
export const GUEST_MONEY_IN = new Set<MoneyStage>(["GUEST_PAID", "IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED", "DISBURSED"]);
/** Stages in which NoLSAF holds money it still owes the payee. */
export const OWED_TO_PAYEE = new Set<MoneyStage>(["GUEST_PAID", "IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED"]);

/**
 * Owner-invoice disbursements keyed by invoice id, newest first. Pass ids to
 * narrow the scan; omit them for every owner-invoice disbursement.
 */
export async function loadOwnerInvoiceDisbursements(ids?: number[]): Promise<Map<number, StageDisbursement[]>> {
  const bySource = new Map<number, StageDisbursement[]>();
  const chunks = ids ? Array.from({ length: Math.ceil(ids.length / 1000) }, (_, i) => ids.slice(i * 1000, i * 1000 + 1000)) : [undefined];
  for (const chunk of chunks) {
    if (chunk && !chunk.length) continue;
    const rows = await prisma.disbursement.findMany({
      where: { sourceType: "OWNER_INVOICE", ...(chunk ? { sourceId: { in: chunk } } : {}) },
      select: { sourceId: true, status: true, paidAt: true },
      orderBy: { id: "desc" },
    });
    rows.forEach((d) => {
      const list = bySource.get(d.sourceId) ?? [];
      list.push({ status: d.status, paidAt: d.paidAt });
      bySource.set(d.sourceId, list);
    });
  }
  return bySource;
}

/**
 * Money stage of every invoice matching `where`, plus per-stage totals. The
 * stage needs the disbursement rows, so it cannot be a plain SQL filter; both
 * scans are narrow (ids, status and amounts only).
 */
export async function indexMoneyStages(where: Record<string, unknown> = {}): Promise<{ byId: Map<number, StageIndexEntry>; totals: StageTotals[] }> {
  const invoices = await prisma.invoice.findMany({
    where,
    select: { id: true, status: true, invoiceNumber: true, total: true, netPayable: true, commissionAmount: true },
  });
  const bySource = await loadOwnerInvoiceDisbursements(Object.keys(where).length ? invoices.map((i) => i.id) : undefined);

  const byId = new Map<number, StageIndexEntry>();
  const sums = new Map<MoneyStage, { count: number; total: number; netPayable: number; commission: number }>();
  invoices.forEach((inv) => {
    const entry = moneyStageOf(inv, bySource.get(inv.id) ?? []);
    byId.set(inv.id, entry);
    const sum = sums.get(entry.stage) ?? { count: 0, total: 0, netPayable: 0, commission: 0 };
    sum.count += 1;
    sum.total += Number(inv.total ?? 0);
    sum.netPayable += Number(inv.netPayable ?? 0);
    sum.commission += Number(inv.commissionAmount ?? 0);
    sums.set(entry.stage, sum);
  });

  const totals = MONEY_STAGES.map((s) => ({ stage: s.key, label: s.label, ...(sums.get(s.key) ?? { count: 0, total: 0, netPayable: 0, commission: 0 }) }));
  return { byId, totals };
}
