// =============================================================================
// Sales partner level model — SINGLE SOURCE OF TRUTH.
//
// A level is earned on ONE signal: eligible net revenue the partner's active
// attributions generated for NoLSAF over the trailing twelve months, across
// both streams.
//
// It is deliberately NOT based on property count. At the current room-night
// price, three 80-room hotels earn a partner more than twenty guest houses, so
// a count-based ladder would reward chasing small properties, which is the
// opposite of what the economics want. See docs/SALES_PARTNER_WORKSPACE.md
// section 7.4.
//
// Benefits are visibility and progress display only. Commission rate is
// intentionally NOT a level benefit: rates live on the signed contract, so a
// promotion can never silently change what a partner is owed.
//
// Both /api/sales/me (partner dashboard) and the admin partner detail view
// import this, so the level can never disagree between the two.
// =============================================================================

export type SalesPartnerLevel = "STARTER" | "GROWTH" | "PROFESSIONAL" | "SENIOR" | "REGIONAL_LEAD";

export interface SalesPartnerLevelBenefits {
  /** Human label shown on the partner header. */
  badge: string;
  /** One-line description of what the level means. */
  summary: string;
}

export interface SalesPartnerLevelSpec {
  level: SalesPartnerLevel;
  /** Trailing twelve month eligible net revenue generated for NoLSAF, in TZS. */
  minRevenue: number;
  /**
   * Secondary floor on active attributed properties. Defaulted to 0 and
   * normally unused; kept so a count condition can be reintroduced later
   * without reshaping anything.
   */
  minProperties: number;
  /** Levels an admin must grant explicitly; revenue alone does not confer them. */
  requiresAdminApproval: boolean;
  benefits: SalesPartnerLevelBenefits;
}

// Listed HIGHEST FIRST so the first qualifying level wins.
// Thresholds are a starting guess. Ship levels as display only and set the real
// numbers after three months of live data.
export const SALES_PARTNER_LEVELS: SalesPartnerLevelSpec[] = [
  {
    level: "REGIONAL_LEAD",
    minRevenue: 0,
    minProperties: 0,
    requiresAdminApproval: true,
    benefits: { badge: "Regional lead", summary: "Leads a region and supports other partners" },
  },
  {
    level: "SENIOR",
    minRevenue: 15_000_000,
    minProperties: 0,
    requiresAdminApproval: true,
    benefits: { badge: "Senior partner", summary: "Consistently generates high value portfolios" },
  },
  {
    level: "PROFESSIONAL",
    minRevenue: 6_000_000,
    minProperties: 0,
    requiresAdminApproval: false,
    benefits: { badge: "Professional partner", summary: "An established portfolio producing steady revenue" },
  },
  {
    level: "GROWTH",
    minRevenue: 1_500_000,
    minProperties: 0,
    requiresAdminApproval: false,
    benefits: { badge: "Growth partner", summary: "Building a portfolio that is starting to compound" },
  },
  {
    level: "STARTER",
    minRevenue: 0,
    minProperties: 0,
    requiresAdminApproval: false,
    benefits: { badge: "Starter partner", summary: "Newly activated and building a first portfolio" },
  },
];

export interface SalesPartnerLevelInputs {
  /** Trailing twelve month eligible net revenue generated for NoLSAF, in TZS. */
  revenueGenerated: number;
  /** Count of ACTIVE attributions, used only by the secondary floor. */
  activeProperties: number;
  /**
   * Level an admin has explicitly granted, if any. Admin-approval levels are
   * never reached automatically, and an explicit grant is never demoted by
   * this function.
   */
  adminGrantedLevel?: SalesPartnerLevel | null;
}

export interface SalesPartnerLevelNext {
  level: SalesPartnerLevel;
  badge: string;
  /** Revenue required to reach it, in TZS. */
  requiredRevenue: number;
  /** Revenue still to go, in TZS. Never negative. */
  remainingRevenue: number;
  /** 0 to 1. */
  progress: number;
  /** True when the next level is only reachable by admin decision. */
  requiresAdminApproval: boolean;
}

export interface SalesPartnerLevelResult {
  level: SalesPartnerLevel;
  benefits: SalesPartnerLevelBenefits;
  revenueGenerated: number;
  activeProperties: number;
  /** Null once the partner is at the top of the automatic ladder. */
  next: SalesPartnerLevelNext | null;
}

/** Levels reachable without an admin decision, highest first. */
const AUTOMATIC_LEVELS = SALES_PARTNER_LEVELS.filter((spec) => !spec.requiresAdminApproval);

function specFor(level: SalesPartnerLevel): SalesPartnerLevelSpec {
  return SALES_PARTNER_LEVELS.find((spec) => spec.level === level) || SALES_PARTNER_LEVELS[SALES_PARTNER_LEVELS.length - 1];
}

/**
 * Resolve a partner's level from their revenue. An admin-granted level always
 * wins, so a promotion is never undone by a quiet quarter.
 */
export function resolveSalesPartnerLevel(inputs: SalesPartnerLevelInputs): SalesPartnerLevelResult {
  const revenue = Number.isFinite(inputs.revenueGenerated) ? Math.max(0, inputs.revenueGenerated) : 0;
  const properties = Number.isFinite(inputs.activeProperties) ? Math.max(0, inputs.activeProperties) : 0;

  const earned =
    AUTOMATIC_LEVELS.find((spec) => revenue >= spec.minRevenue && properties >= spec.minProperties) ||
    AUTOMATIC_LEVELS[AUTOMATIC_LEVELS.length - 1];

  const granted = inputs.adminGrantedLevel ? specFor(inputs.adminGrantedLevel) : null;

  // An explicit grant outranks whatever the revenue says, in either direction:
  // admin-only levels cannot be earned, and an earned level is never used to
  // override a decision an admin made deliberately.
  const grantedIsHigher =
    granted !== null &&
    SALES_PARTNER_LEVELS.indexOf(granted) < SALES_PARTNER_LEVELS.indexOf(earned);
  const current = grantedIsHigher ? granted : earned;

  return {
    level: current.level,
    benefits: current.benefits,
    revenueGenerated: revenue,
    activeProperties: properties,
    next: nextSalesPartnerLevel(current.level, revenue),
  };
}

/**
 * The level immediately above `level` on the automatic ladder, with progress
 * toward it. Returns null at the top of the automatic ladder, since anything
 * beyond it is an admin decision rather than a target a partner can work at.
 */
export function nextSalesPartnerLevel(
  level: SalesPartnerLevel,
  revenueGenerated: number,
): SalesPartnerLevelNext | null {
  const index = AUTOMATIC_LEVELS.findIndex((spec) => spec.level === level);
  // Not on the automatic ladder at all (an admin-granted level), or already at
  // its top: there is nothing to progress toward.
  if (index <= 0) return null;

  const target = AUTOMATIC_LEVELS[index - 1];
  const revenue = Math.max(0, revenueGenerated);
  const remaining = Math.max(0, target.minRevenue - revenue);
  const progress = target.minRevenue > 0 ? Math.min(1, revenue / target.minRevenue) : 1;

  return {
    level: target.level,
    badge: target.benefits.badge,
    requiredRevenue: target.minRevenue,
    remainingRevenue: remaining,
    progress,
    requiresAdminApproval: target.requiresAdminApproval,
  };
}
