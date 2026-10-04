// Stock insight arithmetic (docs/NRMS_STOCK_AND_PURCHASING.md sections 7.5,
// 7.6 and milestone 6): what a menu item costs to make, how supplier prices
// moved, what has stopped moving, what breakfast used, and the owner digest.
// Kept free of the database so each rule is tested alone.

import { perUnitConsumption, roundMoney, roundQty } from "./nrmsInventory.js";

export type RecipeCostLine = { quantity: number; yieldPercent: number; unitCost: number };

/** Cost to make one menu item from its recipe at the given unit costs. */
export function recipeCost(lines: RecipeCostLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + perUnitConsumption({ quantity: line.quantity, yieldPercent: line.yieldPercent }) * line.unitCost, 0));
}

export type MenuProfit = { cost: number; profit: number; margin: number | null; belowCost: boolean; lowMargin: boolean };

/**
 * Profit on one menu item at its menu price. A margin under the target is
 * flagged; below cost is flagged harder (common after a supplier price rise).
 */
export function menuItemProfit(input: { price: number; cost: number; targetMargin?: number }): MenuProfit {
  const profit = roundMoney(input.price - input.cost);
  const margin = input.price > 0 ? Math.round((profit / input.price) * 1000) / 10 : null;
  const target = input.targetMargin ?? 60;
  return { cost: roundMoney(input.cost), profit, margin, belowCost: input.price > 0 && profit < 0, lowMargin: margin != null && margin < target };
}

export type PricePoint = { unitCost: number; at: Date; flag?: string };

/**
 * How one good's price from one supplier moved: the latest price against the
 * one before it and against the first in the window.
 */
export function priceMovement(points: PricePoint[]): { latest: number; previous: number | null; first: number; changePercent: number | null; windowChangePercent: number | null; receipts: number; flagged: number } | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = sorted[sorted.length - 1].unitCost;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2].unitCost : null;
  const first = sorted[0].unitCost;
  const pct = (from: number | null) => (from && from > 0 ? Math.round(((latest - from) / from) * 1000) / 10 : null);
  return { latest, previous, first, changePercent: pct(previous), windowChangePercent: sorted.length > 1 ? pct(first) : null, receipts: sorted.length, flagged: sorted.filter((point) => point.flag && point.flag !== "NONE").length };
}

/** Goods holding stock with no movement for `days`. Counts do not count as movement: a counted bottle is still unsold. */
export function isDeadStock(input: { quantity: number; lastMovedAt: Date | null; days: number; now?: Date }): boolean {
  if (input.quantity <= 0) return false;
  if (!input.lastMovedAt) return true;
  const now = input.now ?? new Date();
  return now.getTime() - input.lastMovedAt.getTime() >= input.days * 86_400_000;
}

export type BreakfastRecipeLine = { stockItemId: number; quantity: number };

/** What a morning's breakfast used: per-cover quantities times covers, whole goods rounded up (you cannot serve 0.4 of an egg). */
export function breakfastUsage(covers: number, recipe: BreakfastRecipeLine[], countStyleOf: (stockItemId: number) => string): Array<{ stockItemId: number; quantity: number }> {
  if (!(covers > 0)) return [];
  return recipe
    .filter((line) => line.quantity > 0)
    .map((line) => {
      const raw = line.quantity * covers;
      return { stockItemId: line.stockItemId, quantity: countStyleOf(line.stockItemId) === "WHOLE" ? Math.ceil(roundQty(raw)) : roundQty(raw) };
    })
    .filter((line) => line.quantity > 0);
}

/** A service date as the integer used for sourceId on breakfast movements (20260925). */
export function breakfastSourceId(serviceDate: string): number {
  return Number(serviceDate.replace(/-/g, ""));
}

/** Whether a digest is due now, at or after 07:00 in Dar es Salaam. */
export function digestDue(input: { frequency: string; lastSentAt: Date | null; now?: Date }): boolean {
  if (input.frequency !== "DAILY" && input.frequency !== "WEEKLY") return false;
  const now = input.now ?? new Date();
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  if (eat.getUTCHours() < 7) return false;
  if (!input.lastSentAt) return true;
  const lastEat = new Date(input.lastSentAt.getTime() + 3 * 3_600_000);
  const sameDay = lastEat.toISOString().slice(0, 10) === eat.toISOString().slice(0, 10);
  if (input.frequency === "DAILY") return !sameDay;
  return now.getTime() - input.lastSentAt.getTime() >= 7 * 86_400_000 - 3_600_000;
}

export type DigestInput = {
  currency: string;
  variances: Array<{ name: string; locationName: string; varianceSales: number; varianceCost: number }>;
  priceJumps: Array<{ name: string; supplierName: string | null; changePercent: number }>;
  bigWriteOffs: Array<{ name: string; value: number; reason: string }>;
  lowWithoutOrder: Array<{ name: string; locationName: string }>;
  overduePayables: { total: number; suppliers: number };
};

export type DigestLine = { kind: "VARIANCE" | "PRICE" | "WASTAGE" | "REORDER" | "PAYABLES"; text: string; tone: "bad" | "warn" | "info" };

function money(value: number, currency: string): string {
  return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * The owner digest in fixed wording: the biggest losses first, then what
 * needs a decision. No free text reaches it, so a message can never carry
 * something a template did not intend.
 */
export function buildDigest(input: DigestInput): { lines: DigestLine[]; headline: string } {
  const lines: DigestLine[] = [];
  const losses = input.variances.filter((row) => row.varianceSales < 0 || row.varianceCost < 0)
    .sort((a, b) => (a.varianceSales || a.varianceCost) - (b.varianceSales || b.varianceCost))
    .slice(0, 3);
  for (const row of losses) {
    const value = row.varianceSales < 0 ? `${money(-row.varianceSales, input.currency)} at menu price` : `${money(-row.varianceCost, input.currency)} at cost`;
    lines.push({ kind: "VARIANCE", tone: "bad", text: `${row.name} at ${row.locationName}: short by ${value} on the last count.` });
  }
  for (const row of input.priceJumps.slice(0, 3)) {
    lines.push({ kind: "PRICE", tone: "warn", text: `${row.name}${row.supplierName ? ` from ${row.supplierName}` : ""} went up ${row.changePercent}%.` });
  }
  for (const row of input.bigWriteOffs.slice(0, 3)) {
    lines.push({ kind: "WASTAGE", tone: "warn", text: `${row.name} written off (${row.reason.toLowerCase().replace(/_/g, " ")}), ${money(row.value, input.currency)}.` });
  }
  if (input.lowWithoutOrder.length) {
    const names = input.lowWithoutOrder.slice(0, 3).map((row) => row.name).join(", ");
    const more = input.lowWithoutOrder.length > 3 ? ` and ${input.lowWithoutOrder.length - 3} more` : "";
    lines.push({ kind: "REORDER", tone: "info", text: `Low with nothing on order: ${names}${more}.` });
  }
  if (input.overduePayables.total > 0) {
    lines.push({ kind: "PAYABLES", tone: "warn", text: `${money(input.overduePayables.total, input.currency)} overdue to ${input.overduePayables.suppliers} ${input.overduePayables.suppliers === 1 ? "supplier" : "suppliers"}.` });
  }
  const headline = lines.length === 0
    ? "Stock is in order: no losses, price jumps or overdue bills to report."
    : `${lines.length} ${lines.length === 1 ? "thing needs" : "things need"} your attention in stock.`;
  return { lines, headline };
}
