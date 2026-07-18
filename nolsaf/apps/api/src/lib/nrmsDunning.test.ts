import { describe, expect, it } from "vitest";
import { evaluateNrmsDunning } from "./nrmsDunning.js";

const now = new Date("2026-07-18T12:00:00.000Z");
const base = { reminderAmount: 25_000, warningAmount: 40_000, unpaidLimit: 50_000, graceDays: 3, now };

describe("evaluateNrmsDunning", () => {
  it("keeps reminder debt operational", () => {
    expect(evaluateNrmsDunning({ ...base, balance: 30_000 }).stage).toBe("REMINDER");
    expect(evaluateNrmsDunning({ ...base, balance: 30_000 }).status).toBe("ACTIVE");
  });

  it("starts grace instead of freezing immediately at the limit", () => {
    const result = evaluateNrmsDunning({ ...base, balance: 50_000 });
    expect(result.stage).toBe("GRACE");
    expect(result.status).toBe("WARNING");
    expect(result.freezeAt?.toISOString()).toBe("2026-07-21T12:00:00.000Z");
  });

  it("requires payment after grace expires", () => {
    const result = evaluateNrmsDunning({
      ...base,
      balance: 50_000,
      limitReachedAt: new Date("2026-07-15T11:59:59.000Z"),
    });
    expect(result.stage).toBe("PAYMENT_REQUIRED");
    expect(result.status).toBe("PAYMENT_REQUIRED");
  });

  it("clears the limit clock after balance falls below the limit", () => {
    const result = evaluateNrmsDunning({ ...base, balance: 39_000, limitReachedAt: new Date("2026-07-10T00:00:00.000Z") });
    expect(result.limitReachedAt).toBeNull();
    expect(result.status).toBe("ACTIVE");
  });

  it("never overwrites a temporary admin freeze", () => {
    const result = evaluateNrmsDunning({ ...base, balance: 80_000, currentStatus: "FROZEN" });
    expect(result.status).toBe("FROZEN");
    expect(result.stage).toBe("CURRENT");
  });
});
