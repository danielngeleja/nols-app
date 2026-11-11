import {
  ATTRIBUTION_STATUSES,
  CONTRACT_EARNING_STATUSES,
  productsForProposal,
  type AttributionStatus,
  type ProductType,
  type ProposedProduct,
} from "./salesPartner.js";

export type AttributionContract = {
  id: number;
  status: string;
  startsAt: Date;
  expiresAt: Date;
};

export function currentAttributionContract<T extends AttributionContract>(
  contracts: readonly T[],
  at = new Date(),
): T | null {
  return (
    contracts
      .filter(
        (contract) =>
          CONTRACT_EARNING_STATUSES.includes(contract.status as any) &&
          contract.startsAt.getTime() <= at.getTime() &&
          contract.expiresAt.getTime() > at.getTime(),
      )
      .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null
  );
}

export function requestedAttributionProducts(proposal: string): ProductType[] {
  return productsForProposal(proposal as ProposedProduct);
}

export function canActivateAttribution(status: string): boolean {
  return status === "VERIFIED";
}

export function canRevokeAttribution(status: string): boolean {
  return ATTRIBUTION_STATUSES.includes(status as AttributionStatus) && status !== "REVOKED" && status !== "LAPSED";
}

export function canReassignAttribution(status: string): boolean {
  return ["VERIFIED", "ACTIVE", "DISPUTED", "EXPIRED", "REVOKED", "LAPSED"].includes(status);
}

export function attributionCommissionStart(contract: AttributionContract, at = new Date()): Date {
  return contract.startsAt.getTime() > at.getTime() ? contract.startsAt : at;
}

// ── NRMS adoption ────────────────────────────────────────────────────────────
//
// A partner may say they persuaded an owner to use both the marketplace and
// NRMS. The marketplace claim stands on the listing; the NRMS claim only means
// something once the owner actually switches NRMS on for that property
// (Property.nrmsActivatedAt). Until then it earns nothing, but it still
// reserves the property for NRMS. So:
//   * it cannot be activated before NRMS is switched on;
//   * if NRMS was already on before the partner registered the lead, the
//     partner did not bring it, and only an administrator's recorded override
//     can activate it;
//   * if NRMS is not switched on within NRMS_ADOPTION_DAYS of approval, the
//     claim lapses and the property is free for whoever really gets the owner
//     onto NRMS. The owner is never asked anything extra.

export const NRMS_ADOPTION_DAYS = 90;
/** Statuses an unadopted NRMS claim can lapse from. */
export const NRMS_LAPSABLE_STATUSES = ["PENDING", "VERIFIED", "ACTIVE", "DISPUTED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type NrmsClaim = {
  productType: string;
  status: string;
  attributedAt: Date;
  /** Reset on reassignment and takeover, so a new partner gets a fresh window. */
  verifiedAt: Date | null;
};

/** When the adoption window started: approval, or the original claim if never approved. */
export function nrmsClaimClockStart(claim: Pick<NrmsClaim, "attributedAt" | "verifiedAt">): Date {
  return claim.verifiedAt ?? claim.attributedAt;
}

/** The moment an unadopted NRMS claim lapses, or null when it cannot lapse. */
export function nrmsLapsesAt(claim: NrmsClaim, nrmsActivatedAt: Date | null): Date | null {
  if (claim.productType !== "NRMS" || nrmsActivatedAt) return null;
  if (!(NRMS_LAPSABLE_STATUSES as readonly string[]).includes(claim.status)) return null;
  return new Date(nrmsClaimClockStart(claim).getTime() + NRMS_ADOPTION_DAYS * DAY_MS);
}

export type NrmsActivationCheck = "OK" | "NOT_SWITCHED_ON" | "ON_BEFORE_CLAIM";

/**
 * Whether an NRMS claim may be activated. `claimedAt` is when the partner
 * registered the lead (or the attribution, when there is no lead).
 */
export function nrmsActivationCheck(input: { nrmsActivatedAt: Date | null; claimedAt: Date }): NrmsActivationCheck {
  if (!input.nrmsActivatedAt) return "NOT_SWITCHED_ON";
  if (input.nrmsActivatedAt.getTime() < input.claimedAt.getTime()) return "ON_BEFORE_CLAIM";
  return "OK";
}
