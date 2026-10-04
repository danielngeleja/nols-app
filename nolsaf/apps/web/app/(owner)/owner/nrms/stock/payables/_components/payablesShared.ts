// Shapes and labels for Supplier payables (docs/NRMS_STOCK_AND_PURCHASING.md,
// milestone 5).

export type Buckets = { CURRENT: number; DAYS_1_30: number; DAYS_31_60: number; DAYS_OVER_60: number };

export const BUCKET_LABELS: Array<[keyof Buckets, string]> = [
  ["CURRENT", "Not yet due"],
  ["DAYS_1_30", "1 to 30 days late"],
  ["DAYS_31_60", "31 to 60 days late"],
  ["DAYS_OVER_60", "Over 60 days late"],
];

export type PayableSupplier = {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  paymentTerms: string;
  creditDeliveries: number;
  creditValue: number;
  paid: number;
  lastPaidAt: string | null;
  outstanding: number;
  credit: number;
  buckets: Buckets;
  overdue: number;
  oldestDue: string | null;
  uninvoiced: number;
  flaggedInvoices: number;
};

export type PayablesSummary = {
  currency: string;
  suppliers: PayableSupplier[];
  totals: { outstanding: number; credit: number; overdue: number; buckets: Buckets };
  flaggedInvoices: number;
};

export type Invoice = {
  id: number;
  supplierId?: number;
  supplierName?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  vatAmount: number;
  receivedValue: number;
  matchStatus: "MATCHED" | "BILLED_MORE" | "BILLED_LESS";
  difference: number;
  deliveries: number;
  photoUrl: string | null;
  note: string | null;
  recordedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

export type Payment = {
  id: number;
  paymentNumber: string;
  supplierId?: number;
  supplierName?: string | null;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  invoiceId?: number | null;
  invoiceNumber?: string | null;
  note: string | null;
  recordedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

export type UninvoicedDelivery = { id: number; receiptNumber: string; receivedAt: string; totalCost: number; paymentMode: string; locationName: string | null };

export type StatementLine = { date: string; kind: string; reference: string; description: string; amount: number; balance: number; sourceId: number };

export type Statement = {
  currency: string;
  supplier: { id: number; name: string; contactName: string | null; phone: string | null; email: string | null; tin: string | null; paymentTerms: string; payChannels: Array<{ label: string; value: string }> | null; status: string };
  range: { from: string | null; to: string | null };
  summary: { opening: number; goods: number; paid: number; adjustments: number; closing: number };
  lines: StatementLine[];
  ageing: { buckets: Buckets; outstanding: number; credit: number; open: Array<{ id: number; receiptNumber: string; amount: number; open: number; dueDate: string; bucket: keyof Buckets }> };
  invoices: Invoice[];
  payments: Payment[];
  uninvoiced: UninvoicedDelivery[];
};

export const MATCH_LABELS: Record<Invoice["matchStatus"], { label: string; tone: "ok" | "low" | "info" }> = {
  MATCHED: { label: "Matches goods", tone: "ok" },
  BILLED_MORE: { label: "Billed more than received", tone: "low" },
  BILLED_LESS: { label: "Billed less than received", tone: "info" },
};

/** Today in Dar es Salaam as YYYY-MM-DD. */
export function todayEat(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Dates in EAT. Date-only fields come back as UTC midnight, which is 03:00 the
 * same day in Dar es Salaam, so both kinds land on the right day.
 */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}
