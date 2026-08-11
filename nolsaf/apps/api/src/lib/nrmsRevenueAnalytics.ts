type MoneyRow = { amount: unknown };

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function sumMoney(rows: MoneyRow[] | null | undefined): number {
  return money((rows ?? []).reduce((sum, row) => sum + money(row.amount), 0));
}

export type AnalyticsSettlementStatus = "FULL" | "PARTIAL" | "UNPAID";

/**
 * A routed amount clears the guest folio without becoming cash. Keeping those
 * concepts separate prevents agency liability from being reported as both a
 * guest debt and a master-folio debt.
 */
export function summarizeAnalyticsGuestFolio(input: {
  roomAmount: unknown;
  extraAmount: unknown;
  directPaid: unknown;
  masterItems?: MoneyRow[] | null;
}) {
  const confirmed = money(money(input.roomAmount) + money(input.extraAmount));
  const directPaid = money(input.directPaid);
  const transferred = sumMoney(input.masterItems);
  const due = Math.max(0, money(confirmed - directPaid - transferred));
  const settledResponsibility = money(directPaid + transferred);
  const status: AnalyticsSettlementStatus = confirmed > 0 && due <= 0.005
    ? "FULL"
    : settledResponsibility > 0
      ? "PARTIAL"
      : "UNPAID";
  return { confirmed, directPaid, transferred, due, status };
}

/** One agency payment is cash once; the routed items remain revenue metadata. */
export function summarizeAnalyticsMasterFolio(input: {
  items?: MoneyRow[] | null;
  payments?: MoneyRow[] | null;
  refunds?: MoneyRow[] | null;
}) {
  const billed = sumMoney(input.items);
  const paymentsReceived = sumMoney(input.payments);
  const refunded = sumMoney(input.refunds);
  const paid = money(paymentsReceived - refunded);
  const balance = money(billed - paid);
  return {
    billed,
    paymentsReceived,
    refunded,
    paid,
    balance,
    due: Math.max(0, balance),
    credit: Math.max(0, money(-balance)),
    active: billed > 0.005 || paid > 0.005,
  };
}
