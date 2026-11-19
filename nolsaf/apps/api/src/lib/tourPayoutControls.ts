// Admin-set controls on top of the Tour Operator Disbursement Policy
// (tourPayoutPolicy.ts). The policy numbers themselves stay in code because
// operators were told them and the operator agreement needs notice before
// they change. These controls only TIGHTEN how NoLSAF releases the money:
//
//  - Advance exposure limit per tier: the most advance money (TZS) one
//    operator may hold across all trips that have not finished yet. Without
//    it the 70% cap is per booking, so an operator with many upcoming trips
//    could hold 70% of every one of them at once.
//  - Separate approver: the admin who approves a tour payout (advance or
//    balance) must not be the admin who verified it.
//
// The exposure limit is a published operator rule (policy section 3.7), so it
// only applies from the policy version that announced it, after the notice
// period. The separate approver is internal and applies at once.
//
// Both read SystemSetting per call, so a change in Settings applies at once.
// When the columns are missing (migration not applied yet) the built-in
// defaults below apply: the controls fail closed, never open.

import { prisma } from "@nolsaf/prisma";
import type { AgentTier } from "./agentLevel.js";
import { getFxRates } from "./fx.js";
import { ADVANCE_LIVE_STATUSES, TOUR_PAYOUT_POLICY_HISTORY, tourPayoutPolicyAt } from "./tourPayoutPolicy.js";

/** When the open-advance limit starts to apply (the first policy version that publishes it), or null. */
export function openAdvanceLimitEffectiveFrom(): string | null {
  return TOUR_PAYOUT_POLICY_HISTORY.find((v) => v.terms.openAdvanceLimit)?.effectiveFrom ?? null;
}
import { isAdvanceRow } from "./tourPayouts.js";

export const ADVANCE_EXPOSURE_TIERS = ["SILVER", "GOLD", "PLATINUM"] as const;
export type AdvanceExposureTier = (typeof ADVANCE_EXPOSURE_TIERS)[number];
/** TZS per tier; null means no limit for that tier. */
export type AdvanceExposureLimits = Record<AdvanceExposureTier, number | null>;

export const DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS: AdvanceExposureLimits = {
  SILVER: 25_000_000,
  GOLD: 75_000_000,
  PLATINUM: 200_000_000,
};
export const ADVANCE_EXPOSURE_LIMIT_MIN_TZS = 100_000;
export const ADVANCE_EXPOSURE_LIMIT_MAX_TZS = 2_000_000_000;

export type TourPayoutControls = {
  advanceExposureLimitsTzs: AdvanceExposureLimits;
  separateApprover: boolean;
};

/** Booking states where an advance is no longer exposure: earned, or handled by a recovery. */
const EXPOSURE_CLOSED_BOOKING_STATUSES = ["COMPLETED", "CANCELED", "CANCELLED", "REFUNDED"];

function limitOrDefault(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Stored JSON to a full per-tier map. Missing tiers take the default; explicit null means no limit. */
export function normalizeExposureLimits(raw: unknown): AdvanceExposureLimits {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS };
  for (const tier of ADVANCE_EXPOSURE_TIERS) {
    if (tier in src) out[tier] = limitOrDefault(src[tier], DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS[tier]);
  }
  return out;
}

export async function loadTourPayoutControls(): Promise<TourPayoutControls> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { tourAdvanceExposureLimits: true, tourPayoutSeparateApprover: true } as any,
    });
    return {
      advanceExposureLimitsTzs: normalizeExposureLimits((row as any)?.tourAdvanceExposureLimits),
      separateApprover: (row as any)?.tourPayoutSeparateApprover !== false,
    };
  } catch (err: any) {
    console.error("[tourPayoutControls] settings unavailable, using built-in defaults:", err?.code || err?.message || err);
    return { advanceExposureLimitsTzs: { ...DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS }, separateApprover: true };
  }
}

export function exposureLimitForTier(limits: AdvanceExposureLimits, tier: AgentTier): number | null {
  return (ADVANCE_EXPOSURE_TIERS as readonly string[]).includes(tier) ? limits[tier as AdvanceExposureTier] : null;
}

async function tzsRate(currency: string | null | undefined): Promise<number | null> {
  const code = String(currency || "TZS").toUpperCase();
  if (code === "TZS") return 1;
  const rate = Number((await getFxRates()).tzsPerUnit?.[code]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Advance money (TZS) an operator holds on trips that have not finished:
 * every advance that is claimed, verified, approved or paid on a booking that
 * is not completed, cancelled or refunded. Null when a currency has no FX
 * rate, which callers must treat as "cannot prove it is under the limit".
 */
export async function loadOperatorAdvanceExposureTzs(operatorAgentId: number): Promise<number | null> {
  const rows = await prisma.tourFinancialTransaction.findMany({
    where: {
      kind: "PAYOUT",
      status: { in: [...ADVANCE_LIVE_STATUSES] },
      booking: { operatorAgentId, status: { notIn: EXPOSURE_CLOSED_BOOKING_STATUSES } },
    },
    select: { amount: true, currency: true, metadata: true },
  });
  let total = 0;
  for (const row of rows) {
    if (!isAdvanceRow(row.metadata)) continue;
    const rate = await tzsRate(row.currency);
    if (rate === null) return null;
    total += (Number(row.amount) || 0) * rate;
  }
  return Math.round(total);
}

export type ExposureCheck =
  | { ok: true; limitTzs: number | null; exposureTzs: number; afterTzs: number }
  | { ok: false; reason: "over_limit" | "fx_unavailable"; limitTzs: number | null; exposureTzs: number | null; afterTzs: number | null; message: string };

/**
 * Whether adding `addAmount` (in `currency`) keeps the operator inside their
 * tier's exposure limit. `alreadyCounted` is true when the amount is a row
 * that is already in a live status (an approved advance being paid), so it is
 * not counted twice.
 */
export async function checkAdvanceExposure(input: {
  operatorAgentId: number;
  tier: AgentTier;
  addAmount: number;
  currency: string | null | undefined;
  alreadyCounted?: boolean;
  controls?: TourPayoutControls;
  /** The moment the rule is judged at; the limit only exists from the policy version that published it. */
  at?: Date;
}): Promise<ExposureCheck> {
  if (!tourPayoutPolicyAt(input.at ?? new Date()).terms.openAdvanceLimit) {
    return { ok: true, limitTzs: null, exposureTzs: 0, afterTzs: 0 };
  }
  const controls = input.controls ?? (await loadTourPayoutControls());
  const limit = exposureLimitForTier(controls.advanceExposureLimitsTzs, input.tier);
  const exposure = await loadOperatorAdvanceExposureTzs(input.operatorAgentId);
  const rate = await tzsRate(input.currency);
  if (limit === null) {
    return { ok: true, limitTzs: null, exposureTzs: exposure ?? 0, afterTzs: exposure ?? 0 };
  }
  if (exposure === null || rate === null) {
    return {
      ok: false,
      reason: "fx_unavailable",
      limitTzs: limit,
      exposureTzs: exposure,
      afterTzs: null,
      message: "An exchange rate is missing, so the operator's open advances cannot be checked against their limit.",
    };
  }
  const add = input.alreadyCounted ? 0 : Math.round((Number(input.addAmount) || 0) * rate);
  const after = exposure + add;
  if (after > limit) {
    return {
      ok: false,
      reason: "over_limit",
      limitTzs: limit,
      exposureTzs: exposure,
      afterTzs: after,
      message: `Open advances would reach TZS ${after.toLocaleString("en-US")}, above the ${input.tier} limit of TZS ${limit.toLocaleString("en-US")} across trips that have not finished.`,
    };
  }
  return { ok: true, limitTzs: limit, exposureTzs: exposure, afterTzs: after };
}
