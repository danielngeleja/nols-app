import { prisma } from "@nolsaf/prisma";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;
const DAY_MS = 86400000;

type SignalInput = { propertyId: number; kind: string; severity?: string; metricValue?: number; baseline?: number; details: Record<string, unknown> };

export async function computeNrmsIntegritySignals(now = new Date()) {
  const observedTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const observedFrom = new Date(observedTo.getTime() - 30 * DAY_MS);
  const recent3 = new Date(observedTo.getTime() - 3 * DAY_MS);
  const accounts = await db.ownerPaygAccount.findMany({ select: { propertyId: true } });
  let created = 0;

  for (const { propertyId } of accounts) {
    const [orders, voidedCharges, lastAudit, shifts, reservationEvents, metrics] = await Promise.all([
      db.nrmsOutletOrder.findMany({ where: { propertyId, createdAt: { gte: observedFrom, lt: observedTo } }, select: { id: true, status: true, voidedAt: true, cancelledAt: true, outletId: true, createdById: true, createdAt: true } }),
      db.reservationCharge.findMany({ where: { reservation: { propertyId, checkedOutAt: { not: null } }, voidedAt: { gte: observedFrom, lt: observedTo } }, select: { id: true, voidedAt: true, reservation: { select: { checkedOutAt: true } } } }),
      db.nrmsNightAuditRun.findFirst({ where: { propertyId, status: "CLOSED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
      db.nrmsCashierShift.findMany({ where: { propertyId, closedAt: { gte: observedFrom, lt: observedTo }, variance: { not: null } }, select: { id: true, userId: true, variance: true } }),
      db.reservationEvent.findMany({ where: { reservation: { propertyId }, type: "CHECKED_IN", createdAt: { gte: observedFrom, lt: observedTo } }, select: { id: true, data: true } }),
      db.nrmsPublicMetric.findMany({ where: { propertyId, metricDate: { gte: observedFrom, lt: observedTo } } }),
    ]);

    const signals: SignalInput[] = [];
    const lateVoids = voidedCharges.filter((charge: any) => charge.voidedAt && charge.reservation.checkedOutAt && new Date(charge.voidedAt) > new Date(charge.reservation.checkedOutAt)).length;
    const disrupted = orders.filter((o: any) => o.voidedAt || o.cancelledAt || ["VOIDED", "CANCELLED"].includes(o.status)).length;
    const disruptionRate = orders.length ? disrupted / orders.length : 0;
    if (orders.length >= 10 && disruptionRate >= 0.2) signals.push({ propertyId, kind: "VOID_CANCEL_RATE", metricValue: disruptionRate, baseline: 0.1, details: { disrupted, orders: orders.length } });
    const groupOrderRate = (key: "outletId" | "createdById", prefix: string) => {
      const grouped = new Map<number, any[]>();
      for (const order of orders) {
        const id = order[key];
        if (!id) continue;
        const rows = grouped.get(id) ?? [];
        rows.push(order);
        grouped.set(id, rows);
      }
      for (const [id, rows] of grouped) {
        const groupDisrupted = rows.filter((o: any) => o.voidedAt || o.cancelledAt || ["VOIDED", "CANCELLED"].includes(o.status)).length;
        const rate = rows.length ? groupDisrupted / rows.length : 0;
        if (rows.length >= 5 && rate >= Math.max(0.2, disruptionRate * 1.5)) {
          signals.push({ propertyId, kind: `${prefix}_${id}`, metricValue: rate, baseline: disruptionRate, details: { targetId: id, disrupted: groupDisrupted, orders: rows.length } });
        }
      }
    };
    groupOrderRate("outletId", "OUTLET_VOID_CANCEL");
    groupOrderRate("createdById", "STAFF_VOID_CANCEL");
    if (lateVoids > 0) signals.push({ propertyId, kind: "FOLIO_VOID_AFTER_CHECKOUT", severity: "HIGH", metricValue: lateVoids, details: { count: lateVoids } });
    const recentOrders = orders.filter((o: any) => new Date(o.createdAt) >= recent3).length;
    if (recentOrders > 0 && (!lastAudit?.completedAt || new Date(lastAudit.completedAt) < recent3)) signals.push({ propertyId, kind: "NIGHT_AUDIT_MISSING", severity: "HIGH", metricValue: recentOrders, details: { recentOrders, lastAuditAt: lastAudit?.completedAt ?? null } });
    const shiftsByUser = new Map<number, any[]>();
    for (const shift of shifts) {
      if (Math.abs(Number(shift.variance)) < 1000) continue;
      const rows = shiftsByUser.get(shift.userId) ?? [];
      rows.push(shift);
      shiftsByUser.set(shift.userId, rows);
    }
    for (const [userId, rows] of shiftsByUser) {
      if (rows.length >= 3) signals.push({ propertyId, kind: `CASH_VARIANCE_STAFF_${userId}`, severity: "HIGH", metricValue: rows.length, details: { userId, shiftIds: rows.map((s: any) => s.id) } });
    }
    const readinessOverrides = reservationEvents.filter((event: any) => event.data && typeof event.data === "object" && event.data.overrideRoomReadiness === true).length;
    if (readinessOverrides >= 3) signals.push({ propertyId, kind: "READINESS_OVERRIDES", metricValue: readinessOverrides, details: { count: readinessOverrides } });
    const rateLimits = metrics.filter((m: any) => String(m.kind).startsWith("QR_RATE_LIMIT")).reduce((sum: number, m: any) => sum + Number(m.count), 0);
    if (rateLimits >= 10) signals.push({ propertyId, kind: "QR_RATE_LIMIT_REJECTIONS", metricValue: rateLimits, details: { count: rateLimits } });
    const rotations = metrics.filter((m: any) => m.kind === "QR_ROTATION").reduce((sum: number, m: any) => sum + Number(m.count), 0);
    if (rotations >= 5) signals.push({ propertyId, kind: "QR_ROTATION_FREQUENCY", metricValue: rotations, details: { count: rotations } });

    for (const signal of signals) {
      await db.nrmsIntegritySignal.upsert({
        where: { propertyId_kind_observedTo: { propertyId, kind: signal.kind, observedTo } },
        update: { severity: signal.severity ?? "ATTENTION", metricValue: signal.metricValue, baseline: signal.baseline, details: signal.details },
        create: { ...signal, severity: signal.severity ?? "ATTENTION", observedFrom, observedTo },
      });
      created += 1;
    }
  }
  return { properties: accounts.length, signals: created };
}

export function startNrmsIntegritySignalsWorker() {
  const intervalMs = Math.max(60 * 60_000, Number(process.env.NRMS_INTEGRITY_INTERVAL_MS || 24 * 60 * 60_000));
  const run = () => runNrmsWorker("integrity", () => computeNrmsIntegritySignals()).catch((error) => console.error("[nrms-integrity] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-integrity] Started, interval: ${intervalMs / 1000}s`);
}
