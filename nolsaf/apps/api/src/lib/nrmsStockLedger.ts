// Stock in the books (docs/NRMS_STOCK_AND_PURCHASING.md section 8.2,
// milestone 5). Night Audit turns every stock movement not yet posted into
// balanced ledger entries, valued at the cost the movement itself recorded, so
// history never changes when the average moves.
//
//   Goods received note     1200 Inventory  /  tender (paid) or 2400 Payable (credit), one per note
//   Sales                   5010/5020 Cost of sales  /  1200 Inventory
//   Wastage, staff meals, complimentary, count results   5030 to 5060  /  1200
//   Opening counts and plain corrections   1200  /  3900 Opening stock and corrections
//   Transfers               nothing (same stock, same property); goods lost in
//                           transit post as 5060 Stock variance when received.
//
// Each movement is stamped with the Night Audit run that posted it, so a
// movement is posted exactly once however the audit windows overlap.

import { GOODS_RECEIPT_SOURCE, MOVEMENT_SOURCE } from "./nrmsInventory.js";

export type LedgerEntry = { accountCode: string; accountName: string; accountType: string; debit: number; credit: number };
export type StockPosting = {
  sourceKey: string;
  sourceType: string;
  sourceId: number;
  description: string;
  currency: string;
  occurredAt: Date;
  entries: LedgerEntry[];
};

export const INVENTORY = { code: "1200", name: "Inventory, food and beverage", type: "ASSET" };
export const PAYABLE = { code: "2400", name: "Accounts payable", type: "LIABILITY" };
export const OPENING_STOCK = { code: "3900", name: "Opening stock and corrections", type: "EQUITY" };

export const STOCK_ACCOUNTS: Record<string, { code: string; name: string; type: string }> = {
  COGS_BEVERAGE: { code: "5010", name: "Cost of sales, beverage", type: "EXPENSE" },
  COGS_FOOD: { code: "5020", name: "Cost of sales, food", type: "EXPENSE" },
  WASTAGE: { code: "5030", name: "Stock wastage", type: "EXPENSE" },
  STAFF_MEAL: { code: "5040", name: "Staff meals", type: "EXPENSE" },
  COMPLIMENTARY: { code: "5050", name: "Complimentary", type: "EXPENSE" },
  VARIANCE: { code: "5060", name: "Stock variance", type: "EXPENSE" },
  OPENING: OPENING_STOCK,
};

export const BEVERAGE_CATEGORIES = new Set(["BEER", "SPIRITS", "WINE", "SOFT_DRINKS", "WATER"]);

/** Same tender accounts as guest payments and expenses in owner.nrms.finance.ts. */
export function tenderAccount(method: string | null | undefined) {
  if (method === "CASH") return { code: "1000", name: "Cash on hand" };
  if (method === "MOBILE_MONEY") return { code: "1010", name: "Mobile money clearing" };
  if (method === "CARD") return { code: "1020", name: "Card clearing" };
  if (method === "BANK") return { code: "1030", name: "Bank" };
  return { code: "1090", name: "Other settlement clearing" };
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type UsageMovement = { type: string; totalCost: number; category: string; plainReceipt?: boolean };

/**
 * Which account a non-receipt movement lands in, or null when it posts
 * nothing here (transfers, and receipts that belong to a goods received note).
 */
export function usageAccountKey(movement: UsageMovement): string | null {
  switch (movement.type) {
    case "SALE":
    case "SALE_REVERSAL":
    // Breakfast is a sale without per-guest orders: its cost is cost of sales.
    case "BREAKFAST_SERVICE":
      return BEVERAGE_CATEGORIES.has(movement.category) ? "COGS_BEVERAGE" : "COGS_FOOD";
    case "WASTAGE":
      return "WASTAGE";
    case "STAFF_MEAL":
      return "STAFF_MEAL";
    case "COMPLIMENTARY":
      return "COMPLIMENTARY";
    case "COUNT_ADJUSTMENT":
      return "VARIANCE";
    case "OPENING_BALANCE":
      return "OPENING";
    case "RECEIPT":
    case "RECEIPT_REVERSAL":
      return movement.plainReceipt ? "OPENING" : null;
    default:
      // Transfers move stock between shelves of the same property.
      return null;
  }
}

/**
 * One balanced set of entries for everything that used or corrected stock.
 * Each account's side follows its net sign: a day of more sale reversals than
 * sales credits cost of sales rather than posting a negative debit.
 */
export function usageEntries(movements: UsageMovement[]): LedgerEntry[] {
  const byAccount = new Map<string, number>();
  let inventory = 0;
  for (const movement of movements) {
    const key = usageAccountKey(movement);
    if (!key) continue;
    const value = round2(movement.totalCost);
    inventory = round2(inventory + value);
    // Stock leaving (negative value) is an expense of the same size.
    byAccount.set(key, round2((byAccount.get(key) ?? 0) - value));
  }
  const entries: LedgerEntry[] = [];
  const order = ["COGS_BEVERAGE", "COGS_FOOD", "WASTAGE", "STAFF_MEAL", "COMPLIMENTARY", "VARIANCE", "OPENING"];
  for (const key of order) {
    const amount = byAccount.get(key) ?? 0;
    if (amount === 0) continue;
    const account = STOCK_ACCOUNTS[key];
    entries.push({ accountCode: account.code, accountName: account.name, accountType: account.type, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  }
  if (inventory !== 0) entries.push({ accountCode: INVENTORY.code, accountName: INVENTORY.name, accountType: INVENTORY.type, debit: inventory > 0 ? inventory : 0, credit: inventory < 0 ? -inventory : 0 });
  return entries;
}

/** A goods received note entering stock, or its void taking it back out. */
export function receiptEntries(receipt: { totalCost: number; paymentMode: string; paymentMethod: string | null }, reversal: boolean): LedgerEntry[] {
  const amount = round2(receipt.totalCost);
  if (amount <= 0) return [];
  const tender = tenderAccount(receipt.paymentMethod);
  const counter = receipt.paymentMode === "CREDIT"
    ? { accountCode: PAYABLE.code, accountName: PAYABLE.name, accountType: PAYABLE.type }
    : { accountCode: tender.code, accountName: tender.name, accountType: "ASSET" };
  const stock = { accountCode: INVENTORY.code, accountName: INVENTORY.name, accountType: INVENTORY.type };
  return reversal
    ? [{ ...counter, debit: amount, credit: 0 }, { ...stock, debit: 0, credit: amount }]
    : [{ ...stock, debit: amount, credit: 0 }, { ...counter, debit: 0, credit: amount }];
}

/**
 * Build the stock postings for one Night Audit run. Returns the movement ids
 * to stamp with the run once its ledger rows are written.
 */
export async function buildStockPostings(tx: any, input: {
  propertyId: number;
  reportNumber: string;
  currency: string;
  occurredAt: Date;
  closeBoundary: Date;
  window: { start: Date; end: Date };
}): Promise<{ postings: StockPosting[]; movementIds: number[] }> {
  const { propertyId, currency } = input;
  const movements = await tx.nrmsStockMovement.findMany({
    where: { propertyId, ledgerRunId: null, createdAt: { lt: input.closeBoundary } },
    select: { id: true, type: true, totalCost: true, sourceType: true, sourceId: true, createdAt: true, stockItem: { select: { category: true } } },
    orderBy: { id: "asc" },
  });
  const transfers = await tx.nrmsStockTransfer.findMany({
    where: { propertyId, status: "RECEIVED", receivedAt: { gte: input.window.start, lt: input.window.end } },
    select: { id: true, transferNumber: true, receivedAt: true, lines: { select: { quantitySent: true, quantityReceived: true, unitCost: true } } },
  });

  const postings: StockPosting[] = [];

  // Receipt reversals point at the movement they reverse; find which were goods received notes.
  const reversedIds = movements.filter((row: any) => row.type === "RECEIPT_REVERSAL" && row.sourceType === MOVEMENT_SOURCE && row.sourceId).map((row: any) => row.sourceId);
  const originals = reversedIds.length
    ? await tx.nrmsStockMovement.findMany({ where: { id: { in: reversedIds } }, select: { id: true, sourceType: true, sourceId: true } })
    : [];
  const originalById = new Map<number, any>(originals.map((row: any) => [row.id, row]));

  const receivedNotes = new Set<number>();
  const voidedNotes = new Set<number>();
  const usage: UsageMovement[] = [];
  for (const row of movements) {
    const totalCost = Number(row.totalCost) || 0;
    if (row.type === "RECEIPT" && row.sourceType === GOODS_RECEIPT_SOURCE && row.sourceId) { receivedNotes.add(row.sourceId); continue; }
    if (row.type === "RECEIPT_REVERSAL") {
      const original = row.sourceId ? originalById.get(row.sourceId) : null;
      if (original?.sourceType === GOODS_RECEIPT_SOURCE && original.sourceId) { voidedNotes.add(original.sourceId); continue; }
      usage.push({ type: row.type, totalCost, category: row.stockItem?.category ?? "OTHER", plainReceipt: true });
      continue;
    }
    usage.push({ type: row.type, totalCost, category: row.stockItem?.category ?? "OTHER", plainReceipt: row.type === "RECEIPT" });
  }

  const noteIds = [...new Set([...receivedNotes, ...voidedNotes])];
  const notes = noteIds.length
    ? await tx.nrmsGoodsReceipt.findMany({ where: { id: { in: noteIds }, propertyId }, select: { id: true, receiptNumber: true, totalCost: true, paymentMode: true, paymentMethod: true, receivedAt: true, decidedAt: true, voidedAt: true, supplier: { select: { name: true } } } })
    : [];
  for (const note of notes) {
    const from = note.supplier?.name ? ` from ${note.supplier.name}` : "";
    const receipt = { totalCost: Number(note.totalCost) || 0, paymentMode: note.paymentMode, paymentMethod: note.paymentMethod };
    if (receivedNotes.has(note.id)) {
      const entries = receiptEntries(receipt, false);
      if (entries.length) postings.push({ sourceKey: `STOCK_GRN:${propertyId}:${note.id}`, sourceType: "STOCK_RECEIPT", sourceId: note.id, description: `Goods received ${note.receiptNumber}${from}${note.paymentMode === "CREDIT" ? " on credit" : ""}`, currency, occurredAt: note.decidedAt ?? note.receivedAt, entries });
    }
    if (voidedNotes.has(note.id)) {
      const entries = receiptEntries(receipt, true);
      if (entries.length) postings.push({ sourceKey: `STOCK_GRN_VOID:${propertyId}:${note.id}`, sourceType: "STOCK_RECEIPT_REVERSAL", sourceId: note.id, description: `Reversal: goods received ${note.receiptNumber}${from}`, currency, occurredAt: note.voidedAt ?? input.occurredAt, entries });
    }
  }

  const usageLines = usageEntries(usage);
  if (usageLines.length) {
    postings.push({ sourceKey: `STOCK_USAGE:${propertyId}:${input.reportNumber}`, sourceType: "STOCK_USAGE", sourceId: propertyId, description: "Stock sold, used, written off and counted", currency, occurredAt: input.occurredAt, entries: usageLines });
  }

  for (const transfer of transfers) {
    const lost = round2(transfer.lines.reduce((sum: number, line: any) => sum + Math.max(0, Number(line.quantitySent) - Number(line.quantityReceived ?? 0)) * Number(line.unitCost), 0));
    if (lost <= 0) continue;
    postings.push({
      sourceKey: `STOCK_TRANSFER_LOSS:${propertyId}:${transfer.id}`,
      sourceType: "STOCK_TRANSFER_LOSS",
      sourceId: transfer.id,
      description: `Lost in transit on ${transfer.transferNumber}`,
      currency,
      occurredAt: transfer.receivedAt,
      entries: [
        { accountCode: STOCK_ACCOUNTS.VARIANCE.code, accountName: STOCK_ACCOUNTS.VARIANCE.name, accountType: "EXPENSE", debit: lost, credit: 0 },
        { accountCode: INVENTORY.code, accountName: INVENTORY.name, accountType: INVENTORY.type, debit: 0, credit: lost },
      ],
    });
  }

  return { postings, movementIds: movements.map((row: any) => row.id) };
}
