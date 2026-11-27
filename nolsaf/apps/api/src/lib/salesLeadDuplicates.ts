/**
 * Possible-duplicate scan for a sales lead, shared by the partner's own
 * "register a lead" (routes/sales.leads.ts) and a lead created from an owner's
 * visit request (lib/salesVisitRequests.ts), so both flag the same way.
 */
import {
  findSalesLeadDuplicateMatches,
  type NormalizedSalesLeadIdentity,
  type SalesLeadDuplicateMatch,
} from "./salesLeadMatching.js";

export async function findLeadDuplicates(
  db: any,
  identity: NormalizedSalesLeadIdentity,
  excludeId?: number,
): Promise<SalesLeadDuplicateMatch[]> {
  const strong: any[] = [
    identity.contactPhoneNormalized ? { contactPhoneNormalized: identity.contactPhoneNormalized } : null,
    identity.contactEmailNormalized ? { contactEmailNormalized: identity.contactEmailNormalized } : null,
    identity.registrationNumberNormalized ? { registrationNumberNormalized: identity.registrationNumberNormalized } : null,
    identity.taxNumberNormalized ? { taxNumberNormalized: identity.taxNumberNormalized } : null,
  ].filter(Boolean);

  const baseWhere = {
    ...(excludeId ? { id: { not: excludeId } } : {}),
    status: { notIn: ["LOST", "CANCELLED"] },
  };
  const select = {
    id: true,
    salesPartnerId: true,
    propertyNameNormalized: true,
    contactPhoneNormalized: true,
    contactEmailNormalized: true,
    locationNormalized: true,
    registrationNumberNormalized: true,
    taxNumberNormalized: true,
  };
  // Query strong identifiers separately so a flood of generic equal names can
  // never push an exact phone, email, tax or registration match past `take`.
  const [strongCandidates, nameCandidates] = await Promise.all([
    strong.length
      ? db.salesLead.findMany({ where: { ...baseWhere, OR: strong }, take: 50, orderBy: { id: "desc" }, select })
      : [],
    db.salesLead.findMany({
      where: { ...baseWhere, propertyNameNormalized: identity.propertyNameNormalized },
      take: 50,
      orderBy: { id: "desc" },
      select,
    }),
  ]);
  const candidates = [...new Map(
    [...strongCandidates, ...nameCandidates].map((candidate: any) => [candidate.id, candidate]),
  ).values()];
  return findSalesLeadDuplicateMatches(identity, candidates as any);
}

/** The duplicateEvidence JSON stored on a lead. */
export function duplicateEvidence(matches: SalesLeadDuplicateMatch[], at = new Date()) {
  return {
    checkedAt: at.toISOString(),
    candidates: matches.map((match) => ({ leadId: match.leadId, matchedFields: match.matchedFields, score: match.score })),
  };
}
