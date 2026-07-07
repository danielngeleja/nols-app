/**
 * Commission math, ported from the web (apps/web/lib/priceUtils.ts).
 *
 * The public property endpoints return the owner's NET price. The guest pays
 * the gross price (net + commission). Commission is a per property override
 * (services.commissionPercent) or the system default. The server computes the
 * authoritative total at booking time; this is only for an accurate preview on
 * the review screen so the payment total is never a surprise.
 */

export function getPropertyCommission(services: unknown, systemCommission = 0): number {
  if (!services || typeof services !== "object") return systemCommission;
  const v = (services as Record<string, unknown>).commissionPercent;
  if (v !== undefined && v !== null) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return systemCommission;
}

/** Net owner price plus commission, rounded to 2 decimals. */
export function priceWithCommission(net: number, commissionPercent: number): number {
  if (!net || net <= 0 || !Number.isFinite(net)) return 0;
  if (!Number.isFinite(commissionPercent) || commissionPercent <= 0) return net;
  const safe = Math.max(0, Math.min(100, commissionPercent));
  return Math.round((net + (net * safe) / 100) * 100) / 100;
}
