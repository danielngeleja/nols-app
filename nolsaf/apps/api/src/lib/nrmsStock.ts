// Counted menu stock, shared by the staff order route, the public QR order
// route and the stock editors so quantity moves one way only. stockQuantity
// null = untracked (the manual inStock toggle is the whole story). Tracked
// items reserve their quantity at order creation, restore it on cancellation,
// and flip inStock to false on their own when they hit zero.

/** Thrown when a tracked item cannot cover the requested quantity. */
export class StockError extends Error {
  constructor(public itemName: string) {
    super("STOCK_INSUFFICIENT");
    this.name = "StockError";
  }
}

/**
 * Atomically take the requested quantities out of tracked items. The gte guard
 * makes two concurrent orders race safely: the loser's update matches zero rows
 * and the whole order transaction rolls back instead of overselling.
 */
export async function reserveMenuStock(tx: any, menuItems: Array<{ id: number; name: string; stockQuantity: number | null }>, requested: Map<number, number>) {
  for (const item of menuItems) {
    if (item.stockQuantity == null) continue;
    const need = requested.get(item.id) ?? 0;
    if (need <= 0) continue;
    const updated = await tx.nrmsMenuItem.updateMany({
      where: { id: item.id, stockQuantity: { gte: need } },
      data: { stockQuantity: { decrement: need } },
    });
    if (updated.count !== 1) throw new StockError(item.name);
    await tx.nrmsMenuItem.updateMany({ where: { id: item.id, stockQuantity: { lte: 0 } }, data: { inStock: false } });
  }
}

/**
 * Give a cancelled order's quantities back to tracked items. Coming back from
 * zero re-opens the item: zero was an automatic out, not a manual decision.
 */
export async function restoreMenuStock(tx: any, orderItems: Array<{ menuItemId: number | null; quantity: number }>) {
  for (const line of orderItems) {
    if (!line.menuItemId || line.quantity <= 0) continue;
    const item = await tx.nrmsMenuItem.findUnique({ where: { id: line.menuItemId }, select: { id: true, stockQuantity: true } });
    if (!item || item.stockQuantity == null) continue;
    await tx.nrmsMenuItem.update({
      where: { id: item.id },
      data: { stockQuantity: { increment: line.quantity }, ...(item.stockQuantity <= 0 ? { inStock: true } : {}) },
    });
  }
}

/**
 * Availability + quantity rules shared by the stock toggle and the menu editor.
 * A counted quantity decides availability outright; a bare toggle-on is refused
 * while a tracked item sits at zero, so "in stock" can never contradict the count.
 */
export function deriveStockPatch(
  current: { inStock: boolean; stockQuantity: number | null },
  input: { inStock?: boolean; stockQuantity?: number | null },
): { data: { inStock?: boolean; stockQuantity?: number | null }; error?: string } {
  const data: { inStock?: boolean; stockQuantity?: number | null } = {};
  if (input.stockQuantity !== undefined) {
    data.stockQuantity = input.stockQuantity;
    if (input.stockQuantity != null) {
      data.inStock = input.inStock !== undefined ? input.inStock && input.stockQuantity > 0 : input.stockQuantity > 0;
      return { data };
    }
  }
  if (input.inStock !== undefined) {
    const quantity = input.stockQuantity !== undefined ? input.stockQuantity : current.stockQuantity;
    if (input.inStock && quantity != null && quantity <= 0) {
      return { data, error: "This item is at zero. Enter the quantity received to bring it back in stock." };
    }
    data.inStock = input.inStock;
  }
  return { data };
}
