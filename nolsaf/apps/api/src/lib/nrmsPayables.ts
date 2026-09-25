// What the property owes its suppliers (docs/NRMS_STOCK_AND_PURCHASING.md
// section 5.2, milestone 5). A delivery on credit is owed from the day it is
// accepted; a payment clears the oldest debt first. The invoice documents the
// debt and is checked against what was accepted at the door, but the debt
// itself is what arrived, never what the paper claims.

export const PAYMENT_TERM_DAYS: Record<string, number> = {
  CASH_ON_DELIVERY: 0,
  CREDIT_7: 7,
  CREDIT_14: 14,
  CREDIT_30: 30,
};

export const AGEING_BUCKETS = ["CURRENT", "DAYS_1_30", "DAYS_31_60", "DAYS_OVER_60"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Small rounding gaps between an invoice and the goods are not a dispute. */
export const INVOICE_TOLERANCE = 1;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const DAY = 86_400_000;

export function dueDateFor(receivedAt: Date, paymentTerms: string): Date {
  const days = PAYMENT_TERM_DAYS[paymentTerms] ?? 0;
  return new Date(receivedAt.getTime() + days * DAY);
}

export function bucketFor(dueDate: Date, asOf: Date): AgeingBucket {
  const overdueDays = Math.floor((asOf.getTime() - dueDate.getTime()) / DAY);
  if (overdueDays <= 0) return "CURRENT";
  if (overdueDays <= 30) return "DAYS_1_30";
  if (overdueDays <= 60) return "DAYS_31_60";
  return "DAYS_OVER_60";
}

export type Debt = { id: number; amount: number; dueDate: Date };
export type OpenDebt = Debt & { open: number; bucket: AgeingBucket };

/**
 * Apply payments to the oldest debt first and age what is left. Payments
 * beyond every debt are returned as a credit the supplier holds for us.
 */
export function ageDebts(debts: Debt[], paid: number, asOf: Date): { open: OpenDebt[]; buckets: Record<AgeingBucket, number>; outstanding: number; credit: number } {
  let remaining = Math.max(0, round2(paid));
  const sorted = [...debts].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id - b.id);
  const open: OpenDebt[] = [];
  for (const debt of sorted) {
    const covered = Math.min(remaining, debt.amount);
    remaining = round2(remaining - covered);
    const left = round2(debt.amount - covered);
    if (left > 0) open.push({ ...debt, open: left, bucket: bucketFor(debt.dueDate, asOf) });
  }
  const buckets = { CURRENT: 0, DAYS_1_30: 0, DAYS_31_60: 0, DAYS_OVER_60: 0 } as Record<AgeingBucket, number>;
  for (const debt of open) buckets[debt.bucket] = round2(buckets[debt.bucket] + debt.open);
  return { open, buckets, outstanding: round2(open.reduce((sum, debt) => sum + debt.open, 0)), credit: remaining };
}

/** How an invoice compares with the goods accepted on the deliveries it covers. */
export function invoiceCheck(input: { amount: number; receivedValue: number }): { flag: "MATCHED" | "BILLED_MORE" | "BILLED_LESS"; difference: number } {
  const difference = round2(input.amount - input.receivedValue);
  if (difference > INVOICE_TOLERANCE) return { flag: "BILLED_MORE", difference };
  if (difference < -INVOICE_TOLERANCE) return { flag: "BILLED_LESS", difference };
  return { flag: "MATCHED", difference };
}

export type StatementEvent = {
  date: Date;
  kind: "DELIVERY_CREDIT" | "DELIVERY_PAID" | "DELIVERY_VOIDED" | "PAYMENT" | "PAYMENT_VOIDED" | "INVOICE";
  reference: string;
  description: string;
  /** Change to what we owe: + for goods on credit, - for a payment. */
  amount: number;
  sourceId: number;
};

/** Statement lines in date order with a running balance of what is owed. */
export function statementLines(events: StatementEvent[], openingBalance = 0) {
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime() || a.sourceId - b.sourceId);
  let balance = round2(openingBalance);
  return sorted.map((event) => {
    balance = round2(balance + event.amount);
    return { ...event, balance };
  });
}
