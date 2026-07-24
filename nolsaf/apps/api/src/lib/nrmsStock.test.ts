import { describe, expect, it, vi } from "vitest";
import { StockError, deriveStockPatch, reserveMenuStock, restoreMenuStock } from "./nrmsStock.js";

describe("reserveMenuStock", () => {
  it("decrements tracked items with a gte guard and skips untracked ones", async () => {
    const tx = { nrmsMenuItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const items = [
      { id: 1, name: "Kilimanjaro Lager", stockQuantity: 10 },
      { id: 2, name: "Chips", stockQuantity: null },
    ];
    await reserveMenuStock(tx, items, new Map([[1, 3], [2, 2]]));
    // One guarded decrement + one zero-flip check for the tracked item only.
    expect(tx.nrmsMenuItem.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.nrmsMenuItem.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 1, stockQuantity: { gte: 3 } },
      data: { stockQuantity: { decrement: 3 } },
    });
    expect(tx.nrmsMenuItem.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 1, stockQuantity: { lte: 0 } },
      data: { inStock: false },
    });
  });

  it("throws StockError with the item name when the guard matches nothing", async () => {
    const tx = { nrmsMenuItem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const items = [{ id: 1, name: "Amarula", stockQuantity: 1 }];
    await expect(reserveMenuStock(tx, items, new Map([[1, 2]]))).rejects.toThrowError(StockError);
    await expect(reserveMenuStock(tx, items, new Map([[1, 2]]))).rejects.toMatchObject({ itemName: "Amarula" });
  });
});

describe("restoreMenuStock", () => {
  it("increments tracked items and re-opens one that was auto-outed at zero", async () => {
    const tx = {
      nrmsMenuItem: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 1, stockQuantity: 0 })
          .mockResolvedValueOnce({ id: 2, stockQuantity: 4 })
          .mockResolvedValueOnce({ id: 3, stockQuantity: null }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    await restoreMenuStock(tx, [
      { menuItemId: 1, quantity: 2 },
      { menuItemId: 2, quantity: 1 },
      { menuItemId: 3, quantity: 5 },
      { menuItemId: null, quantity: 1 },
    ]);
    expect(tx.nrmsMenuItem.update).toHaveBeenCalledTimes(2);
    expect(tx.nrmsMenuItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: 1 },
      data: { stockQuantity: { increment: 2 }, inStock: true },
    });
    expect(tx.nrmsMenuItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: 2 },
      data: { stockQuantity: { increment: 1 } },
    });
  });
});

describe("deriveStockPatch", () => {
  it("a positive count puts the item in stock; zero takes it out", () => {
    expect(deriveStockPatch({ inStock: false, stockQuantity: 0 }, { stockQuantity: 12 })).toEqual({ data: { stockQuantity: 12, inStock: true } });
    expect(deriveStockPatch({ inStock: true, stockQuantity: 3 }, { stockQuantity: 0 })).toEqual({ data: { stockQuantity: 0, inStock: false } });
  });

  it("refuses to toggle a tracked zero-quantity item back on", () => {
    const result = deriveStockPatch({ inStock: false, stockQuantity: 0 }, { inStock: true });
    expect(result.error).toBeTruthy();
  });

  it("keeps the plain toggle for untracked items and allows untracking", () => {
    expect(deriveStockPatch({ inStock: true, stockQuantity: null }, { inStock: false })).toEqual({ data: { inStock: false } });
    expect(deriveStockPatch({ inStock: false, stockQuantity: 0 }, { stockQuantity: null, inStock: true })).toEqual({ data: { stockQuantity: null, inStock: true } });
  });

  it("an explicit out wins even with a positive count", () => {
    expect(deriveStockPatch({ inStock: true, stockQuantity: 8 }, { stockQuantity: 8, inStock: false })).toEqual({ data: { stockQuantity: 8, inStock: false } });
  });
});
