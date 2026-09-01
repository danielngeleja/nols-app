import { describe, expect, it } from "vitest";

import { convertFromTzs, FALLBACK_TZS_PER_UNIT, normalizeCurrency, sanitizeTzsPerUnit } from "./money";

describe("native display currency", () => {
  it("converts a TZS display value without changing the authoritative input", () => {
    const settlementAmount = 120_000;
    const shown = convertFromTzs(settlementAmount, "USD", { ...FALLBACK_TZS_PER_UNIT, USD: 2600 });

    expect(shown).toBeCloseTo(46.1538, 4);
    expect(settlementAmount).toBe(120_000);
  });

  it("falls back safely when an API rate is invalid", () => {
    const rates = sanitizeTzsPerUnit({ USD: 0, EUR: Number.NaN, KES: 21, TZS: 1 });

    expect(rates.USD).toBe(FALLBACK_TZS_PER_UNIT.USD);
    expect(rates.EUR).toBe(FALLBACK_TZS_PER_UNIT.EUR);
    expect(rates.KES).toBe(21);
  });

  it("accepts only supported display currencies", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("GBP")).toBeNull();
  });
});
