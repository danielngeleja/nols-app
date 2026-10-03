import { prisma } from "@nolsaf/prisma";

/**
 * What the payment gateway keeps from guest money, by channel. NoLSAF
 * collects through AzamPay: mobile money (MNO) and bank transfers at one
 * rate, cards at another, all deducted from the transaction and carried by
 * NoLSAF's revenue. The rates live in systemsetting.gatewayFeeRates so they
 * can be edited when AzamPay changes them; until a period has fees recorded
 * from a settlement statement, the margin estimates them with these rates.
 */

export type FeeChannel = "MNO" | "BANK" | "CARD";
export type GatewayFeeRates = { provider: string; MNO: number; BANK: number; CARD: number };

export const FEE_CHANNELS: Array<{ key: FeeChannel; label: string }> = [
  { key: "MNO", label: "Mobile money" },
  { key: "BANK", label: "Bank" },
  { key: "CARD", label: "Card" },
];

export const DEFAULT_GATEWAY_FEE_RATES: GatewayFeeRates = { provider: "AzamPay", MNO: 2.5, BANK: 2.5, CARD: 2.9 };

export function normalizeFeeRates(raw: unknown): GatewayFeeRates {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<GatewayFeeRates>;
  const pct = (v: unknown, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 && x <= 20 ? Math.round(x * 100) / 100 : fallback;
  };
  return {
    provider: typeof r.provider === "string" && r.provider.trim() ? r.provider.trim().slice(0, 40) : DEFAULT_GATEWAY_FEE_RATES.provider,
    MNO: pct(r.MNO, DEFAULT_GATEWAY_FEE_RATES.MNO),
    BANK: pct(r.BANK, DEFAULT_GATEWAY_FEE_RATES.BANK),
    CARD: pct(r.CARD, DEFAULT_GATEWAY_FEE_RATES.CARD),
  };
}

/** The channel a stored payment method belongs to. Unknown wallets count as mobile money. */
export function channelOf(method: string | null | undefined): FeeChannel {
  const m = String(method || "").toUpperCase();
  if (/CARD|VISA|MASTER/.test(m)) return "CARD";
  if (/BANK|CRDB|NMB|NBC|EXIM|STANBIC|ABSA|EQUITY|DTB|AZANIA|KCB/.test(m)) return "BANK";
  return "MNO";
}

/** The configured rates, or AzamPay's defaults when none are saved (or the column is not migrated yet). */
export async function gatewayFeeRates(): Promise<GatewayFeeRates> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { id: 1 }, select: { gatewayFeeRates: true } as any });
    return normalizeFeeRates((row as any)?.gatewayFeeRates ?? DEFAULT_GATEWAY_FEE_RATES);
  } catch {
    return { ...DEFAULT_GATEWAY_FEE_RATES };
  }
}

/**
 * Estimated fees for guest money split by channel. GMV the platform cannot
 * attribute to a channel (streams without a recorded payment method) is
 * charged at the mobile money rate, the most common way guests pay.
 */
export function estimateGatewayFees(byChannel: Partial<Record<FeeChannel, number>>, unattributedGmv: number, rates: GatewayFeeRates) {
  const lines = FEE_CHANNELS.map((c) => {
    const gmv = Math.max(0, byChannel[c.key] ?? 0) + (c.key === "MNO" ? Math.max(0, unattributedGmv) : 0);
    return { channel: c.key, label: c.label, gmv: Math.round(gmv * 100) / 100, rate: rates[c.key], fee: Math.round(gmv * rates[c.key]) / 100 };
  });
  return { total: Math.round(lines.reduce((s, l) => s + l.fee, 0) * 100) / 100, lines };
}
