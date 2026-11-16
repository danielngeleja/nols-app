// Is this prospect free for a partner to register?
//
// Asked live while a partner types a new lead, and again on save, so a
// partner learns before doing the work that:
//   - the property is already listed on NoLSAF (a Marketplace claim cannot earn),
//   - another partner already holds it (protected lead, or already converted),
//   - they already registered it themselves.
//
// What the answer may reveal is deliberately narrow. "Listed" is public anyway.
// "Taken" never says by whom, how it matched, or when protection ends (a date
// would tell a partner when to snipe). An expired, unconverted lead of another
// partner frees the property: it is not reported, and on save the existing
// duplicate flag sends the overlap to an administrator as before.
import {
  normalizeSalesLeadEmail,
  normalizeSalesLeadIdentifier,
  normalizeSalesLeadPhone,
} from "./salesLeadMatching.js";

export type LeadAvailabilityInput = {
  propertyName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  region?: string | null;
  district?: string | null;
};

export type LeadAvailability = {
  /** OWN beats TAKEN: a partner is told about their own lead first. */
  lead: "CLEAR" | "OWN" | "TAKEN";
  ownLeadId: number | null;
  /** An approved, public NoLSAF listing with this name in this area. */
  listed: boolean;
};

export type AvailabilityLeadCandidate = {
  id: number;
  salesPartnerId: number;
  status: string;
  protectionExpiresAt: Date | string | null;
  propertyNameNormalized: string | null;
  contactPhoneNormalized: string | null;
  contactEmailNormalized: string | null;
  registrationNumberNormalized: string | null;
  taxNumberNormalized: string | null;
  region: string | null;
  district: string | null;
};

export type AvailabilityPropertyCandidate = {
  title: string;
  status: string;
  regionName: string | null;
  district: string | null;
};

const CLOSED = ["LOST", "CANCELLED"];

// Words that say what kind of place it is, not which place. "Kaje Classic
// Hotel" and "Kaje Classic" are the same prospect.
const KIND_WORDS = new Set([
  "the", "and", "hotel", "hotels", "lodge", "lodges", "guest", "house", "guesthouse", "resort", "resorts",
  "inn", "motel", "hostel", "apartment", "apartments", "villa", "villas", "suites", "suite", "camp", "camps",
  "bnb", "homestay", "cottage", "cottages", "bungalow", "bungalows", "residence", "residences", "ltd", "limited", "co",
]);

function words(value: string | null | undefined): string[] {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The distinctive part of a property name; the full name when nothing distinctive is left. */
export function coreName(value: string | null | undefined): string {
  const all = words(value);
  const core = all.filter((word) => !KIND_WORDS.has(word));
  return (core.length ? core : all).join(" ");
}

/** The longest distinctive word, used to narrow the database search. */
export function nameSearchWord(value: string): string | null {
  const best = coreName(value).split(" ").sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 3 ? best : null;
}

function place(value: string | null | undefined): string {
  return words(value).join("");
}

/**
 * Same area: the same district, or, when either side has no district, the same
 * region. With neither on one side a name alone is too weak ("City Hotel").
 */
export function sameArea(
  left: { region?: string | null; district?: string | null },
  right: { region?: string | null; district?: string | null },
): boolean {
  const leftDistrict = place(left.district);
  const rightDistrict = place(right.district);
  if (leftDistrict && rightDistrict) return leftDistrict === rightDistrict;
  const leftRegion = place(left.region);
  const rightRegion = place(right.region);
  return Boolean(leftRegion && rightRegion && leftRegion === rightRegion);
}

/** Strong identifiers (phone, email, registration, tax) or a name in the same area. */
export function leadMatches(input: LeadAvailabilityInput, candidate: AvailabilityLeadCandidate): boolean {
  const strong: Array<[string | null, string | null]> = [
    [normalizeSalesLeadPhone(input.contactPhone), candidate.contactPhoneNormalized],
    [normalizeSalesLeadEmail(input.contactEmail), candidate.contactEmailNormalized],
    [normalizeSalesLeadIdentifier(input.registrationNumber), candidate.registrationNumberNormalized],
    [normalizeSalesLeadIdentifier(input.taxNumber), candidate.taxNumberNormalized],
  ];
  if (strong.some(([left, right]) => left && right && left === right)) return true;
  const name = coreName(input.propertyName);
  return Boolean(name) && name === coreName(candidate.propertyNameNormalized) && sameArea(input, candidate);
}

export function propertyListedMatch(input: LeadAvailabilityInput, property: AvailabilityPropertyCandidate): boolean {
  if (property.status !== "APPROVED") return false;
  const name = coreName(input.propertyName);
  return Boolean(name)
    && name === coreName(property.title)
    && sameArea(input, { region: property.regionName, district: property.district });
}

export function classifyLeadAvailability(input: {
  partnerId: number;
  identity: LeadAvailabilityInput;
  leads: AvailabilityLeadCandidate[];
  properties: AvailabilityPropertyCandidate[];
  now?: Date;
}): LeadAvailability {
  const now = (input.now ?? new Date()).getTime();
  const matching = input.leads.filter((lead) => !CLOSED.includes(lead.status) && leadMatches(input.identity, lead));
  const own = matching.find((lead) => lead.salesPartnerId === input.partnerId);
  const taken = matching.some((lead) => {
    if (lead.salesPartnerId === input.partnerId) return false;
    if (lead.status === "CONVERTED") return true;
    const expires = lead.protectionExpiresAt ? new Date(lead.protectionExpiresAt).getTime() : 0;
    return expires > now;
  });
  return {
    lead: own ? "OWN" : taken ? "TAKEN" : "CLEAR",
    ownLeadId: own?.id ?? null,
    listed: input.properties.some((property) => propertyListedMatch(input.identity, property)),
  };
}

/** Load the candidates and classify. `excludeLeadId` skips the lead being edited. */
export async function loadLeadAvailability(
  db: any,
  partnerId: number,
  identity: LeadAvailabilityInput,
  excludeLeadId?: number,
): Promise<LeadAvailability> {
  const phone = normalizeSalesLeadPhone(identity.contactPhone);
  const email = normalizeSalesLeadEmail(identity.contactEmail);
  const registration = normalizeSalesLeadIdentifier(identity.registrationNumber);
  const tax = normalizeSalesLeadIdentifier(identity.taxNumber);
  const searchWord = nameSearchWord(identity.propertyName);
  const or: any[] = [
    phone ? { contactPhoneNormalized: phone } : null,
    email ? { contactEmailNormalized: email } : null,
    registration ? { registrationNumberNormalized: registration } : null,
    tax ? { taxNumberNormalized: tax } : null,
    searchWord ? { propertyNameNormalized: { contains: searchWord } } : null,
  ].filter(Boolean);
  const hasArea = Boolean(place(identity.district) || place(identity.region));

  const [leads, properties] = await Promise.all([
    or.length
      ? db.salesLead.findMany({
          where: {
            OR: or,
            status: { notIn: CLOSED },
            ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
          },
          take: 100,
          orderBy: { id: "desc" },
          select: {
            id: true,
            salesPartnerId: true,
            status: true,
            protectionExpiresAt: true,
            propertyNameNormalized: true,
            contactPhoneNormalized: true,
            contactEmailNormalized: true,
            registrationNumberNormalized: true,
            taxNumberNormalized: true,
            region: true,
            district: true,
          },
        })
      : [],
    searchWord && hasArea
      ? db.property.findMany({
          where: { status: "APPROVED", title: { contains: searchWord } },
          take: 50,
          select: { title: true, status: true, regionName: true, district: true },
        })
      : [],
  ]);
  return classifyLeadAvailability({ partnerId, identity, leads, properties });
}

/** The partner-facing refusal for a save, or null when the save may go ahead. */
export function availabilityRefusal(
  availability: LeadAvailability,
  proposedProduct: string,
): { code: string; error: string } | null {
  if (availability.lead === "OWN") {
    return { code: "OWN_LEAD", error: "You already registered this property. Open your existing lead instead." };
  }
  if (availability.lead === "TAKEN") {
    return { code: "LEAD_TAKEN", error: "Another sales partner is already working with this property. Choose a different prospect." };
  }
  if (availability.listed && proposedProduct.includes("MARKETPLACE")) {
    return {
      code: "ALREADY_LISTED",
      error: "This property is already listed on NoLSAF, so a Marketplace claim cannot earn. You can still propose NRMS.",
    };
  }
  return null;
}
