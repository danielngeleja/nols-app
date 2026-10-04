/**
 * Provider-neutral payment vocabulary for the NRMS orchestration core.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Everything here is deliberately free of provider concepts. AzamPay is the
 * first adapter, not the model: a provider's own status strings, reference
 * formats and channel names are translated at the adapter boundary and never
 * reach booking, folio or outlet code.
 *
 * These constants mirror the VarChar columns declared on the payment
 * orchestration models in prisma/schema.prisma. The schema has no Prisma enums
 * anywhere, so the database stores strings and this module is the single place
 * that says which strings are legal.
 */

// ── Channels, purposes, and the NRMS objects a payment can settle ──────────

export const PAYMENT_CHANNELS = ["MNO", "BANK", "CARD", "HOSTED_CHECKOUT"] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_PURPOSES = [
  "ACCOMMODATION",
  "FOLIO",
  "OUTLET_ORDER",
  "MASTER_FOLIO",
  "SERVICE",
  "DEPOSIT",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/**
 * The NRMS row an intent is collecting against. Polymorphic for the same
 * reason Disbursement.sourceType is: one intent table serves accommodation,
 * folio, outlet and agency payments without a foreign key per NRMS object.
 */
export const PAYMENT_SOURCE_TYPES = [
  "RESERVATION",
  "NRMS_OUTLET_ORDER",
  "NRMS_MASTER_FOLIO",
  "NRMS_GUEST_PAYMENT_REQUEST",
] as const;
export type PaymentSourceType = (typeof PAYMENT_SOURCE_TYPES)[number];

// ── Normalized attempt status ─────────────────────────────────────────────

/**
 * The conservative status set every adapter must map its provider's native
 * statuses onto. The provider's own string is always retained alongside this
 * one, so support and dispute evidence never lose fidelity.
 */
export const ATTEMPT_STATUSES = [
  "CREATED",
  "REQUIRES_CUSTOMER_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "STATUS_UNKNOWN",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Statuses that will never change again on their own.
 *
 * STATUS_UNKNOWN is deliberately absent: it is not terminal, it is unresolved.
 * Treating it as terminal is what produces either a stranded payment or a
 * double charge, depending on which way the guess falls.
 */
const TERMINAL_ATTEMPT_STATUSES = new Set<AttemptStatus>([
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

/**
 * Statuses where the provider has taken the request and money may already have
 * moved. Nothing in this set may be retried on the same provider or failed
 * over to another one without reconciliation first establishing the truth.
 */
const MONEY_MAY_HAVE_MOVED = new Set<AttemptStatus>([
  "REQUIRES_CUSTOMER_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "STATUS_UNKNOWN",
]);

export function isTerminalAttemptStatus(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

/**
 * Whether a new attempt may be created for the intent this attempt belongs to.
 *
 * Hard safety rule from the design record: never automatically fail over an
 * accepted, timed-out, processing or unknown attempt to another provider,
 * because the customer could be charged twice. A retry after one of these
 * requires reconciliation, and where double-payment risk remains, an explicit
 * customer action.
 */
export function allowsNewAttempt(status: AttemptStatus): boolean {
  return !MONEY_MAY_HAVE_MOVED.has(status);
}

// ── Normalized intent status ──────────────────────────────────────────────

export const INTENT_STATUSES = [
  "CREATED",
  "ELIGIBILITY_CHECKED",
  "INITIATION_PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "STATUS_UNKNOWN",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "REVERSED",
  "DISPUTED",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/**
 * Legal intent transitions.
 *
 * Written as an explicit map rather than inferred, because the two transitions
 * that matter most are the ones that must NOT exist: a late FAILED can never
 * overwrite a SUCCEEDED, and nothing can leave a post-settlement state except
 * another post-settlement state. A provider that retries an old event out of
 * order is normal, and this map is what makes that harmless.
 */
const INTENT_TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  CREATED: ["ELIGIBILITY_CHECKED", "CANCELLED", "EXPIRED", "FAILED"],
  ELIGIBILITY_CHECKED: ["INITIATION_PENDING", "CANCELLED", "EXPIRED", "FAILED"],
  INITIATION_PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED", "STATUS_UNKNOWN"],
  PROCESSING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED", "STATUS_UNKNOWN"],
  // Reconciliation is the only way out of STATUS_UNKNOWN, and it can resolve
  // in either direction.
  STATUS_UNKNOWN: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  // A settled payment can only be unwound by an explicit post-payment event.
  // It can never silently become FAILED.
  SUCCEEDED: ["PARTIALLY_REFUNDED", "REFUNDED", "REVERSED", "DISPUTED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED", "REVERSED", "DISPUTED"],
  REFUNDED: ["DISPUTED"],
  REVERSED: ["DISPUTED"],
  DISPUTED: ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED", "SUCCEEDED"],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionIntent(from: IntentStatus, to: IntentStatus): boolean {
  if (from === to) return true;
  return INTENT_TRANSITIONS[from].includes(to);
}

/** Intent states in which the money is recognised as collected. */
export function isSettledIntentStatus(status: IntentStatus): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "PARTIALLY_REFUNDED" ||
    status === "REFUNDED" ||
    status === "REVERSED" ||
    status === "DISPUTED"
  );
}

// ── Merchant onboarding status ────────────────────────────────────────────

export const MERCHANT_ACCOUNT_STATUSES = [
  "NOT_SUBSCRIBED",
  "DRAFT",
  "ACTION_REQUIRED",
  "READY_FOR_ADMIN_REVIEW",
  "ADMIN_REJECTED",
  "SUBMISSION_QUEUED",
  "SUBMITTED_TO_PROVIDER",
  "PROVIDER_REVIEW",
  "PROVIDER_ACTION_REQUIRED",
  "PROVIDER_ACCOUNT_CREATED",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
  "CLOSED",
] as const;
export type MerchantAccountStatus = (typeof MERCHANT_ACCOUNT_STATUSES)[number];

/**
 * The only status that may originate a payment, and even then only over a
 * separately enabled channel.
 *
 * Local administrator approval reaches SUBMISSION_QUEUED and stops there.
 * ACTIVE requires a verified provider result carrying the merchant and wallet
 * identifiers routing needs, which is why this is a single-value check rather
 * than a permissive list.
 */
export function canOriginatePayment(status: MerchantAccountStatus): boolean {
  return status === "ACTIVE";
}

// ── Type guards ───────────────────────────────────────────────────────────

function makeGuard<T extends string>(values: readonly T[]) {
  const set = new Set<string>(values);
  return (value: unknown): value is T => typeof value === "string" && set.has(value);
}

export const isPaymentChannel = makeGuard(PAYMENT_CHANNELS);
export const isPaymentPurpose = makeGuard(PAYMENT_PURPOSES);
export const isPaymentSourceType = makeGuard(PAYMENT_SOURCE_TYPES);
export const isAttemptStatus = makeGuard(ATTEMPT_STATUSES);
export const isIntentStatus = makeGuard(INTENT_STATUSES);
export const isMerchantAccountStatus = makeGuard(MERCHANT_ACCOUNT_STATUSES);
