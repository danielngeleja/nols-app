// Purchasing rules for stock control milestone 4 (docs/NRMS_STOCK_AND_PURCHASING.md
// section 5.2): the reorder suggestion, who may approve an order, how much a
// delivery may exceed what was ordered, and what an order's status becomes as
// goods arrive. Kept free of the database so the arithmetic is tested alone.

import { roundQty } from "./nrmsInventory.js";

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
  "CLOSED_SHORT",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** Orders a delivery can still be received against. */
export const RECEIVABLE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];
/** Orders that still count as "on order" for the reorder list. */
export const OPEN_ORDER_STATUSES: readonly PurchaseOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "PARTIALLY_RECEIVED"];

export const REQUISITION_STATUSES = ["OPEN", "PARTLY_ORDERED", "ORDERED", "CLOSED", "CANCELLED"] as const;
export const SEND_CHANNELS = ["WHATSAPP", "SMS", "EMAIL", "PDF"] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

export const PURCHASE_ORDER_SOURCE = "PURCHASE_ORDER";

type Pack = { name: string; baseQuantity: number };

export type ReorderSuggestion = {
  /** Base units needed to reach the target, after what is already on order. */
  shortfall: number;
  /** Base units suggested, rounded up to whole packs when a pack is used. */
  quantity: number;
  pack: Pack | null;
  packCount: number | null;
};

/**
 * How much to buy for one good at one shelf. The target is the par level, or
 * the reorder point when no par is set. Goods already on an open order count
 * as arriving. The suggestion is rounded up to whole packs of the pack the
 * property usually buys in, so the order reads "3 crates", not "71 bottles".
 */
export function suggestReorder(input: {
  onHand: number;
  parLevel: number | null;
  reorderPoint: number | null;
  onOrder: number;
  packs: Pack[];
  preferredPackName?: string | null;
  countStyle?: string;
}): ReorderSuggestion {
  const target = input.parLevel != null && input.parLevel > 0 ? input.parLevel : input.reorderPoint ?? 0;
  let shortfall = roundQty(Math.max(0, target - Math.max(0, input.onHand) - Math.max(0, input.onOrder)));
  // At the reorder point with no par set, target minus stock is zero; still
  // suggest one pack (or one unit) so the line is never an empty order.
  const atPoint = input.reorderPoint != null && input.onHand <= input.reorderPoint && input.onOrder <= 0;
  if (shortfall <= 0 && !atPoint) return { shortfall: 0, quantity: 0, pack: null, packCount: null };
  const pack = pickPack(input.packs, shortfall, input.preferredPackName);
  if (shortfall <= 0) shortfall = pack ? pack.baseQuantity : 1;
  if (!pack) {
    const quantity = input.countStyle === "WHOLE" ? Math.ceil(shortfall) : shortfall;
    return { shortfall, quantity: roundQty(quantity), pack: null, packCount: null };
  }
  const packCount = Math.max(1, Math.ceil(roundQty(shortfall / pack.baseQuantity)));
  return { shortfall, quantity: roundQty(packCount * pack.baseQuantity), pack, packCount };
}

/**
 * The pack to order in: the one last used on a delivery, else the largest pack
 * that fits the need at least once, else the smallest pack. Packs of one base
 * unit are ignored (ordering "1 bottle" packs is the same as ordering bottles).
 */
export function pickPack(packs: Pack[], need: number, preferredName?: string | null): Pack | null {
  const usable = packs.filter((pack) => pack.baseQuantity > 1);
  if (usable.length === 0) return null;
  const preferred = preferredName ? usable.find((pack) => pack.name === preferredName) : undefined;
  if (preferred) return preferred;
  const sorted = [...usable].sort((a, b) => b.baseQuantity - a.baseQuantity);
  return sorted.find((pack) => pack.baseQuantity <= need) ?? sorted[sorted.length - 1];
}

/**
 * Whether an order raised by this role needs the owner (decision D5): the
 * owner never waits; a manager waits only above the owner's limit.
 */
export function orderNeedsOwner(input: { role: string; total: number; limit: number }): boolean {
  if (input.role === "OWNER") return false;
  return input.total > input.limit;
}

/**
 * The most a delivery line may accept against an order line before a manager
 * must accept the excess. Whole goods round the allowance down, so 5% of 24
 * bottles lets one extra bottle through, not 1.2.
 */
export function overDeliveryCeiling(input: { ordered: number; tolerancePercent: number; countStyle: string }): number {
  const allowance = (input.ordered * Math.max(0, input.tolerancePercent)) / 100;
  const extra = input.countStyle === "WHOLE" ? Math.floor(allowance + 1e-9) : allowance;
  return roundQty(input.ordered + extra);
}

/** An order's status once goods have been received against it. */
export function statusAfterReceipt(current: string, lines: Array<{ quantity: number; receivedQuantity: number }>): string {
  if (!RECEIVABLE_ORDER_STATUSES.includes(current as PurchaseOrderStatus) && current !== "RECEIVED") return current;
  const anyReceived = lines.some((line) => line.receivedQuantity > 0);
  const allReceived = lines.length > 0 && lines.every((line) => line.receivedQuantity + 1e-9 >= line.quantity);
  if (allReceived) return "RECEIVED";
  if (anyReceived) return "PARTIALLY_RECEIVED";
  // A void can take an order back to nothing received.
  return current === "PARTIALLY_RECEIVED" || current === "RECEIVED" ? "SENT" : current;
}

/** A requisition's status from how many of its lines are on orders. */
export function requisitionStatus(current: string, lines: Array<{ purchaseOrderId: number | null }>): string {
  if (current === "CLOSED" || current === "CANCELLED") return current;
  const ordered = lines.filter((line) => line.purchaseOrderId != null).length;
  if (ordered === 0) return "OPEN";
  return ordered === lines.length ? "ORDERED" : "PARTLY_ORDERED";
}

/**
 * Tanzanian numbers written the local way (0712 345 678) become the
 * international form wa.me needs (255712345678). Other numbers are passed
 * through as digits.
 */
export function internationalPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (phone.trim().startsWith("+")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `255${digits.slice(1)}`;
  if (digits.length === 9 && /^[67]/.test(digits)) return `255${digits}`;
  return digits;
}

/** The short message that goes with the order link. Plain text, no emoji. */
export function supplierMessage(input: {
  supplierName: string;
  propertyName: string;
  orderNumber: string;
  lineCount: number;
  total: string;
  expectedDate: string | null;
  deliverTo: string;
  link: string;
}): string {
  const lines = [
    `Hello ${input.supplierName},`,
    `${input.propertyName} would like to order ${input.lineCount} ${input.lineCount === 1 ? "item" : "items"} (${input.total}), order ${input.orderNumber}.`,
    input.expectedDate ? `Delivery needed by ${input.expectedDate}, to ${input.deliverTo}.` : `Deliver to ${input.deliverTo}.`,
    `Order details and PDF: ${input.link}`,
    "Please open the link to confirm the order and your delivery date.",
  ];
  return lines.join("\n");
}
