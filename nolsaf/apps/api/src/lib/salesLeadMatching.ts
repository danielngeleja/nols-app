export type SalesLeadIdentityInput = {
  propertyName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  location?: string | null;
  registrationNumber?: string | null;
  taxNumber?: string | null;
};

export type NormalizedSalesLeadIdentity = {
  propertyNameNormalized: string;
  contactPhoneNormalized: string | null;
  contactEmailNormalized: string | null;
  locationNormalized: string | null;
  registrationNumberNormalized: string | null;
  taxNumberNormalized: string | null;
};

export type SalesLeadDuplicateCandidate = NormalizedSalesLeadIdentity & {
  id: number;
  salesPartnerId: number;
};

export type SalesLeadDuplicateMatch = {
  leadId: number;
  salesPartnerId: number;
  score: number;
  matchedFields: string[];
};

function normalizeWords(value: string | null | undefined): string | null {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

export function normalizeSalesLeadPhone(value: string | null | undefined): string | null {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `255${digits.slice(1)}`;
  if (digits.length === 9) digits = `255${digits}`;
  return digits;
}

export function normalizeSalesLeadEmail(value: string | null | undefined): string | null {
  const email = String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en");
  return email || null;
}

export function normalizeSalesLeadIdentifier(value: string | null | undefined): string | null {
  const identifier = String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return identifier || null;
}

export function normalizeSalesLeadIdentity(
  input: SalesLeadIdentityInput,
): NormalizedSalesLeadIdentity {
  const propertyNameNormalized = normalizeWords(input.propertyName);
  if (!propertyNameNormalized) throw new Error("Property name is required");
  return {
    propertyNameNormalized,
    contactPhoneNormalized: normalizeSalesLeadPhone(input.contactPhone),
    contactEmailNormalized: normalizeSalesLeadEmail(input.contactEmail),
    locationNormalized: normalizeWords(input.location),
    registrationNumberNormalized: normalizeSalesLeadIdentifier(input.registrationNumber),
    taxNumberNormalized: normalizeSalesLeadIdentifier(input.taxNumber),
  };
}

/**
 * A warning needs one strong identifier or a name combined with location.
 * Name-only matches are kept below threshold to avoid flagging every generic
 * "City Hotel" as a collision.
 */
export function scoreSalesLeadDuplicate(
  identity: NormalizedSalesLeadIdentity,
  candidate: SalesLeadDuplicateCandidate,
): SalesLeadDuplicateMatch | null {
  const matchedFields: string[] = [];
  let score = 0;
  const match = (
    field: keyof NormalizedSalesLeadIdentity,
    label: string,
    weight: number,
  ) => {
    const left = identity[field];
    const right = candidate[field];
    if (left && right && left === right) {
      matchedFields.push(label);
      score += weight;
    }
  };

  match("registrationNumberNormalized", "registrationNumber", 6);
  match("taxNumberNormalized", "taxNumber", 6);
  match("contactPhoneNormalized", "contactPhone", 5);
  match("contactEmailNormalized", "contactEmail", 5);
  match("propertyNameNormalized", "propertyName", 3);
  match("locationNormalized", "location", 2);

  if (score < 5) return null;
  return {
    leadId: candidate.id,
    salesPartnerId: candidate.salesPartnerId,
    score,
    matchedFields,
  };
}

export function findSalesLeadDuplicateMatches(
  identity: NormalizedSalesLeadIdentity,
  candidates: SalesLeadDuplicateCandidate[],
): SalesLeadDuplicateMatch[] {
  return candidates
    .map((candidate) => scoreSalesLeadDuplicate(identity, candidate))
    .filter((match): match is SalesLeadDuplicateMatch => Boolean(match))
    .sort((left, right) => right.score - left.score || left.leadId - right.leadId);
}
