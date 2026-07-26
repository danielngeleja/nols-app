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
  return ATTRIBUTION_STATUSES.includes(status as AttributionStatus) && status !== "REVOKED";
}

export function canReassignAttribution(status: string): boolean {
  return ["VERIFIED", "ACTIVE", "DISPUTED", "EXPIRED", "REVOKED"].includes(status);
}

export function attributionCommissionStart(contract: AttributionContract, at = new Date()): Date {
  return contract.startsAt.getTime() > at.getTime() ? contract.startsAt : at;
}
