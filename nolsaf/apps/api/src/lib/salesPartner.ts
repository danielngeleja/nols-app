// =============================================================================
// Sales Partner Workspace — shared value sets and helpers. SINGLE SOURCE OF TRUTH.
//
// The schema stores every status as VarChar with the allowed values in a doc
// comment, matching the rest of this codebase (there are no Prisma enums).
// This module is where those value sets actually live, so Zod validation, the
// route handlers and the UI all read the same list and can never drift.
//
// See docs/SALES_PARTNER_WORKSPACE.md for the model this implements.
// =============================================================================

// ---------------------------------------------------------------------------
// Workspace entitlement
// ---------------------------------------------------------------------------

/** Workspace aliases a user account can hold. NORMAL is implicit for everyone. */
export const WORKSPACE_TYPES = ["NORMAL", "SALES"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const WORKSPACE_ACCESS_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "REVOKED",
] as const;
export type WorkspaceAccessStatus = (typeof WORKSPACE_ACCESS_STATUSES)[number];

// ---------------------------------------------------------------------------
// Partner profile
// ---------------------------------------------------------------------------

export const SALES_PARTNER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "TERMINATED",
] as const;
export type SalesPartnerStatus = (typeof SALES_PARTNER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const CONTRACT_STATUSES = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "SIGNED",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "TERMINATED",
  "RENEWED",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Statuses in which a contract can still earn commission. */
export const CONTRACT_EARNING_STATUSES: readonly ContractStatus[] = ["ACTIVE", "EXPIRING"];

/** Days before expiry at which a reminder fires. Ordered widest first. */
export const CONTRACT_REMINDER_DAYS = [60, 30, 7] as const;

/**
 * A contract enters EXPIRING at the first reminder threshold. It still earns:
 * EXPIRING is a warning state, not a suspension.
 */
export const CONTRACT_EXPIRING_WINDOW_DAYS = CONTRACT_REMINDER_DAYS[0];

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "MEETING_SCHEDULED",
  "PROPOSAL_SENT",
  "DOCUMENTS_PENDING",
  "TRIAL_STARTED",
  "CONVERSION_REQUESTED",
  "CONVERTED",
  "LOST",
  "CANCELLED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses a partner may set directly. Conversion is an admin decision. */
export const PARTNER_SETTABLE_LEAD_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "MEETING_SCHEDULED",
  "PROPOSAL_SENT",
  "DOCUMENTS_PENDING",
  "TRIAL_STARTED",
  "LOST",
  "CANCELLED",
];

/** Leads that are finished and should drop out of the working pipeline. */
export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ["CONVERTED", "LOST", "CANCELLED"];

export const LEAD_ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
  "DOCUMENT_RECEIVED",
  "PROPOSAL_SENT",
  "STATUS_CHANGED",
  "ADMIN_COMMENT",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

/**
 * Activity types that count as real progress and therefore extend the claim
 * protection window. A note to self does not hold a claim open; a meeting does.
 */
export const PROTECTION_EXTENDING_ACTIVITIES: readonly LeadActivityType[] = [
  "CALL",
  "EMAIL",
  "MEETING",
  "DOCUMENT_RECEIVED",
  "PROPOSAL_SENT",
];

/** Claim protection window, in days, from registration or last real activity. */
export const LEAD_PROTECTION_DAYS = 60;

export const PROPOSED_PRODUCTS = ["NRMS", "MARKETPLACE", "NRMS_AND_MARKETPLACE"] as const;
export type ProposedProduct = (typeof PROPOSED_PRODUCTS)[number];

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** One attribution row per (property, productType). */
export const PRODUCT_TYPES = ["NRMS", "MARKETPLACE"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const ATTRIBUTION_STATUSES = [
  "PENDING",
  "VERIFIED",
  "ACTIVE",
  "DISPUTED",
  "REASSIGNED",
  "EXPIRED",
  "REVOKED",
] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

/** Only an ACTIVE attribution accrues commission. */
export const ATTRIBUTION_EARNING_STATUSES: readonly AttributionStatus[] = ["ACTIVE"];

/** Which product a proposed product covers, for creating attributions. */
export function productsForProposal(proposal: ProposedProduct): ProductType[] {
  if (proposal === "NRMS_AND_MARKETPLACE") return ["NRMS", "MARKETPLACE"];
  return [proposal];
}

// ---------------------------------------------------------------------------
// Learning materials
// ---------------------------------------------------------------------------

export const SALES_MATERIAL_CATEGORIES = [
  "PRODUCT_GUIDE",
  "SALES_SCRIPT",
  "PRESENTATION",
  "CASE_STUDY",
  "POLICY",
  "TRAINING",
  "FAQ",
] as const;
export type SalesMaterialCategory = (typeof SALES_MATERIAL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Commission ledger
// ---------------------------------------------------------------------------

export const COMMISSION_TYPES = [
  "NRMS_USAGE",
  "MARKETPLACE_BOOKING",
  "PERFORMANCE_BONUS",
  "MANUAL_ADJUSTMENT",
] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export const COMMISSION_STATUSES = [
  "PENDING",
  "VALIDATING",
  "ELIGIBLE",
  "APPROVED",
  "AVAILABLE",
  "PAID",
  "REVERSED",
  "DISPUTED",
  "CANCELLED",
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** Counted into the partner's pending balance. */
export const PENDING_BALANCE_STATUSES: readonly CommissionStatus[] = [
  "PENDING",
  "VALIDATING",
  "ELIGIBLE",
  "APPROVED",
];

/** Counted into the withdrawable balance. Only AVAILABLE may be claimed. */
export const AVAILABLE_BALANCE_STATUSES: readonly CommissionStatus[] = ["AVAILABLE"];

/**
 * Refund and chargeback windows before an earning is safe to pay out.
 * Marketplace is longer because a guest can still cancel a stay; NRMS money
 * has already been collected from the owner and rarely reverses.
 * Open decision 2 in the doc: these are the recommended values.
 */
export const VALIDATION_WINDOW_DAYS: Record<"NRMS_USAGE" | "MARKETPLACE_BOOKING", number> = {
  NRMS_USAGE: 7,
  MARKETPLACE_BOOKING: 30,
};

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export const PAYOUT_STATUSES = [
  "DRAFT",
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "REJECTED",
  "CANCELLED",
  "FAILED",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Payout states that still hold their commissions locked. */
export const PAYOUT_LOCKING_STATUSES: readonly PayoutStatus[] = [
  "DRAFT",
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
  "PAID",
];

/** States from which commissions are released back to AVAILABLE. */
export const PAYOUT_RELEASING_STATUSES: readonly PayoutStatus[] = [
  "REJECTED",
  "CANCELLED",
  "FAILED",
];

/** Minimum withdrawal, in TZS. Open decision 3 in the doc. */
export const MIN_PAYOUT_AMOUNT = 50_000;

// ---------------------------------------------------------------------------
// Rate fallbacks
// ---------------------------------------------------------------------------

/**
 * Used only when SystemSetting has no value, for example on a fresh database
 * before the row is seeded. Never read these in the commission engine: the
 * engine reads the rate snapshotted on the contract. See doc section 7.
 */
export const FALLBACK_NRMS_COMMISSION_PERCENT = 14;
export const FALLBACK_MARKETPLACE_REVENUE_PERCENT = 20;

/** Default contract term. */
export const CONTRACT_TERM_DAYS = 365;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the idempotency key for a commission. The unique index on
 * SalesCommission.sourceKey is what makes a replayed webhook a no-op instead
 * of a double payout, so every writer must go through this function.
 */
export function commissionSourceKey(
  source: "NRMS_STATEMENT" | "INVOICE" | "BONUS" | "ADJUSTMENT",
  id: number | string,
): string {
  return `${source}:${id}`;
}

/**
 * Agent code, for example NSA-DAR-0042. Region is reduced to three letters so
 * the code stays readable and stable; the sequence is zero padded to four.
 */
export function buildAgentCode(region: string | null | undefined, sequence: number): string {
  const slug = String(region || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  return `NSA-${slug}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Mask a payout account for display, keeping only the last four characters.
 * Applied at the API boundary everywhere except the owning partner's own
 * settings screen.
 */
export function maskPayoutAccount(account: string | null | undefined): string | null {
  const value = String(account || "").trim();
  if (!value) return null;
  if (value.length <= 4) return value;
  return value.slice(-4);
}

/** Whole days from now until `date`, negative once it has passed. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Whether a contract may earn commission right now. Both the commission
 * engines and the workspace gate call this, so access and earning can never
 * disagree about what "active" means.
 */
export function isContractEarning(
  contract: { status: string; startsAt: Date; expiresAt: Date } | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!contract) return false;
  if (!CONTRACT_EARNING_STATUSES.includes(String(contract.status).toUpperCase() as ContractStatus)) {
    return false;
  }
  return contract.startsAt.getTime() <= at.getTime() && contract.expiresAt.getTime() > at.getTime();
}
