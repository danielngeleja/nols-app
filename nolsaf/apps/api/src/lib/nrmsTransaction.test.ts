import { describe, expect, it, vi } from "vitest";
import { isTransactionCapacityError, NRMS_PAYMENT_TRANSACTION_OPTIONS, runNrmsPaymentTransaction } from "./nrmsTransaction.js";

describe("NRMS payment transaction", () => {
  it("uses scoped limits and returns the committed result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const tx = { marker: true };
    const client = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const callback = vi.fn(async () => ({ id: 8 }));
    expect(await runNrmsPaymentTransaction(client, 8, callback)).toEqual({ id: 8 });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), NRMS_PAYMENT_TRANSACTION_OPTIONS);
    expect(callback).toHaveBeenCalledWith(tx);
    vi.restoreAllMocks();
  });
  it("does not retry a failed financial transaction", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = { code: "P2028" };
    const client = { $transaction: vi.fn().mockRejectedValue(error) };
    await expect(runNrmsPaymentTransaction(client, 8, async () => null)).rejects.toBe(error);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it("recognizes capacity failures without masking unrelated errors", () => {
    expect(isTransactionCapacityError({ code: "P2028" })).toBe(true);
    expect(isTransactionCapacityError({ code: "P2024" })).toBe(true);
    expect(isTransactionCapacityError({ code: "P2002" })).toBe(false);
    expect(isTransactionCapacityError(null)).toBe(false);
  });
});
