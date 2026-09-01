export const SUPPORTED_CURRENCY_CODES = ["TZS", "USD", "EUR", "KES"] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export type TzsPerUnit = Record<SupportedCurrencyCode, number>;

export const FALLBACK_TZS_PER_UNIT: TzsPerUnit = {
  TZS: 1,
  USD: 2600,
  EUR: 2800,
  KES: 20
};

export const CURRENCY_META: Record<
  SupportedCurrencyCode,
  { name: string; symbol: string; decimals: number; flag: string }
> = {
  TZS: { name: "Tanzanian Shilling", symbol: "TSh", decimals: 0, flag: "🇹🇿" },
  USD: { name: "US Dollar", symbol: "$", decimals: 2, flag: "🇺🇸" },
  EUR: { name: "Euro", symbol: "€", decimals: 2, flag: "🇪🇺" },
  KES: { name: "Kenyan Shilling", symbol: "KSh", decimals: 0, flag: "🇰🇪" }
};

export function normalizeCurrency(value: unknown): SupportedCurrencyCode | null {
  const code = String(value || "").trim().toUpperCase();
  return SUPPORTED_CURRENCY_CODES.includes(code as SupportedCurrencyCode)
    ? (code as SupportedCurrencyCode)
    : null;
}

export function sanitizeTzsPerUnit(value: unknown): TzsPerUnit {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return SUPPORTED_CURRENCY_CODES.reduce<TzsPerUnit>(
    (rates, code) => {
      const candidate = Number(source[code]);
      rates[code] = Number.isFinite(candidate) && candidate > 0 ? candidate : FALLBACK_TZS_PER_UNIT[code];
      return rates;
    },
    { ...FALLBACK_TZS_PER_UNIT }
  );
}

/** Presentation-only conversion. The authoritative TZS input is never mutated. */
export function convertFromTzs(
  amountTzs: number,
  displayCurrency: SupportedCurrencyCode,
  tzsPerUnit: TzsPerUnit
): number | null {
  if (!Number.isFinite(amountTzs)) return null;
  if (displayCurrency === "TZS") return amountTzs;
  const rate = tzsPerUnit[displayCurrency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amountTzs / rate;
}

export function formatCurrency(amount: number, currency: SupportedCurrencyCode): string {
  const meta = CURRENCY_META[currency];
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals
    }).format(amount);
  } catch {
    return `${meta.symbol} ${amount.toLocaleString(undefined, {
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals
    })}`;
  }
}
