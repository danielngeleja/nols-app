/**
 * Owner "Request a NoLSAF visit" (docs/SALES_VISIT_REQUESTS.md).
 *
 * An owner asks for a visit on a public page. No partner is listed publicly:
 * NoLSAF routes the request. An admin may assign it to any active partner; a
 * Regional lead may assign it to an active partner of their own region, never
 * to themself. Assigning creates an ordinary SalesLead for that partner, with
 * the same availability and duplicate rules as a lead the partner registers,
 * so the owner's phone reaches only the assigned partner.
 */
import { randomBytes } from "node:crypto";
import { LEAD_PROTECTION_DAYS, isContractEarning } from "./salesPartner.js";
import { normalizeSalesLeadIdentity, normalizeSalesLeadPhone } from "./salesLeadMatching.js";
import { availabilityRefusal, loadLeadAvailability } from "./salesLeadAvailability.js";
import { duplicateEvidence, findLeadDuplicates } from "./salesLeadDuplicates.js";

export const VISIT_INTERESTS = ["MARKETPLACE", "NRMS", "NRMS_AND_MARKETPLACE", "NOT_SURE"] as const;
export type VisitInterest = (typeof VISIT_INTERESTS)[number];
export const VISIT_PRODUCTS = ["MARKETPLACE", "NRMS", "NRMS_AND_MARKETPLACE"] as const;
export type VisitProduct = (typeof VISIT_PRODUCTS)[number];
export const VISIT_STATUSES = ["NEW", "ASSIGNED", "CLOSED"] as const;

/** A second request from the same phone inside this window returns the first. */
export const VISIT_DEDUPE_DAYS = 14;
/** The assigned partner's first follow-up is due this soon. */
export const VISIT_FOLLOW_UP_HOURS = 48;
const DAY_MS = 86_400_000;

export class VisitRequestError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/** Not migrated yet: the route answers "not available" instead of failing. */
export function isMissingTable(error: any) {
  return error?.code === "P2021" || error?.code === "P2022";
}

// ---------- references ----------

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

export function newVisitRef(bytes: Buffer = randomBytes(8)): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `VR-${out}`;
}

export function isVisitRef(value: unknown): value is string {
  return typeof value === "string" && /^VR-[A-HJ-NP-Z2-9]{8}$/.test(value);
}

/** What the owner chose, as the product the partner's lead proposes. */
export function productForInterest(interest: string): VisitProduct {
  return (VISIT_PRODUCTS as readonly string[]).includes(interest) ? (interest as VisitProduct) : "NRMS_AND_MARKETPLACE";
}

// ---------- creating ----------

export type VisitRequestInput = {
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  propertyName: string;
  propertyType: string | null;
  estimatedRooms: number | null;
  regionCode: string | null;
  location: string;
  interest: VisitInterest;
  message: string | null;
};

export async function publicRegions(db: any): Promise<Array<{ code: string; name: string }>> {
  const rows = await db.salesRegion.findMany({ where: { status: "ACTIVE" }, select: { code: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((r: any) => ({ code: r.code, name: r.name }));
}

/**
 * Saves the owner's request, or returns the open one already sent from the
 * same phone in the last VISIT_DEDUPE_DAYS (so a double tap or a retry never
 * makes two). `created` says which.
 */
export async function createVisitRequest(db: any, input: VisitRequestInput, meta: { ipHash: string | null; now?: Date }) {
  const now = meta.now ?? new Date();
  const phone = normalizeSalesLeadPhone(input.contactPhone);
  if (!phone || phone.length < 9 || phone.length > 15) throw new VisitRequestError("Enter a phone number we can call you on.");

  const existing = await db.salesVisitRequest.findFirst({
    where: { contactPhoneNormalized: phone, status: { in: ["NEW", "ASSIGNED"] }, createdAt: { gte: new Date(now.getTime() - VISIT_DEDUPE_DAYS * DAY_MS) } },
    select: { id: true, publicRef: true, regionId: true, status: true },
    orderBy: { id: "desc" },
  });
  if (existing) return { request: existing, created: false };

  const region = input.regionCode
    ? await db.salesRegion.findFirst({ where: { code: input.regionCode, status: "ACTIVE" }, select: { id: true, name: true, leadPartnerId: true } })
    : null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const request = await db.salesVisitRequest.create({
        data: {
          publicRef: newVisitRef(),
          regionId: region?.id ?? null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactPhoneNormalized: phone,
          contactEmail: input.contactEmail,
          propertyName: input.propertyName,
          propertyType: input.propertyType,
          estimatedRooms: input.estimatedRooms,
          location: input.location,
          interest: input.interest,
          message: input.message,
          ipHash: meta.ipHash,
        },
        select: { id: true, publicRef: true, regionId: true, status: true },
      });
      return { request, created: true, region };
    } catch (error: any) {
      // A reference collision (1 in 10^12) just draws another.
      if (error?.code !== "P2002") throw error;
    }
  }
  throw new VisitRequestError("Could not save your request. Please try again.", 503);
}

// ---------- assigning ----------

export type VisitActor =
  | { role: "ADMIN"; userId: number }
  | { role: "REGION_LEAD"; userId: number; region: { id: number; name: string; leadPartnerId: number } };

export async function findVisitRequest(db: any, ref: string) {
  if (!isVisitRef(ref)) return null;
  return db.salesVisitRequest.findUnique({ where: { publicRef: ref } });
}

/** An active partner with an earning contract, by agent code. */
async function assignablePartner(db: any, agentCode: string, now: Date) {
  const partner = await db.salesPartnerProfile.findUnique({
    where: { agentCode: agentCode.trim().toUpperCase() },
    select: {
      id: true,
      userId: true,
      agentCode: true,
      status: true,
      regionId: true,
      user: { select: { name: true, fullName: true, suspendedAt: true, isDisabled: true } },
      contracts: { orderBy: { startsAt: "desc" }, take: 5, select: { status: true, startsAt: true, expiresAt: true } },
    },
  });
  if (!partner) throw new VisitRequestError("No Sales Partner has that code.", 404);
  const blocked = partner.user?.suspendedAt || partner.user?.isDisabled;
  if (partner.status !== "ACTIVE" || blocked || !partner.contracts.some((c: any) => isContractEarning(c, now))) {
    throw new VisitRequestError("Only an active partner with a current agreement can take a visit.", 409);
  }
  return partner;
}

/**
 * Assigns a NEW request to a partner and creates their lead. Runs the same
 * availability rules as a partner registering the lead themself: a property
 * another partner is already working is refused (TAKEN), the partner's own
 * existing lead is linked instead of duplicated, and a property already listed
 * on NoLSAF cannot be proposed for the Marketplace.
 */
export async function assignVisitRequest(
  db: any,
  request: any,
  input: { agentCode: string; product?: VisitProduct | null },
  actor: VisitActor,
  now = new Date(),
) {
  if (request.status !== "NEW") throw new VisitRequestError("This request was already handled.", 409);
  const partner = await assignablePartner(db, input.agentCode, now);
  if (actor.role === "REGION_LEAD") {
    if (request.regionId !== actor.region.id) throw new VisitRequestError("This request is not in your region.", 403);
    if (partner.id === actor.region.leadPartnerId) throw new VisitRequestError("Assign it to a partner in your region. NoLSAF assigns visits to regional leads.", 403);
    if (partner.regionId !== actor.region.id) throw new VisitRequestError("This partner is not in your region.", 403);
  }

  const product = input.product ?? productForInterest(request.interest);
  const identityInput = {
    propertyName: request.propertyName,
    contactPhone: request.contactPhone,
    contactEmail: request.contactEmail,
    location: request.location,
    registrationNumber: null,
    taxNumber: null,
  };
  const availability = await loadLeadAvailability(db, partner.id, {
    propertyName: request.propertyName,
    contactPhone: request.contactPhone,
    contactEmail: request.contactEmail,
    district: request.location,
  });
  if (availability.lead === "TAKEN") {
    throw new VisitRequestError("Another partner is already working with this property. Assign it to them, or close the request.", 409, "LEAD_TAKEN");
  }
  if (availability.lead !== "OWN") {
    const refusal = availabilityRefusal(availability, product);
    if (refusal) throw new VisitRequestError(refusal.code === "ALREADY_LISTED" ? "This property is already listed on NoLSAF. Assign it for NRMS instead." : refusal.error, 409, refusal.code);
  }

  const identity = normalizeSalesLeadIdentity(identityInput);
  const matches = availability.lead === "OWN" ? [] : await findLeadDuplicates(db, identity);
  const regionName = request.regionId
    ? (await db.salesRegion.findUnique({ where: { id: request.regionId }, select: { name: true } }).catch(() => null))?.name ?? null
    : null;
  const by = actor.role === "ADMIN" ? "NoLSAF" : `the ${actor.region.name} regional lead`;

  const result = await db.$transaction(async (tx: any) => {
    // Claimed first, so two people assigning at once cannot both create a lead.
    const claimed = await tx.salesVisitRequest.updateMany({
      where: { id: request.id, status: "NEW" },
      data: { status: "ASSIGNED", assignedPartnerId: partner.id, assignedById: actor.userId, assignedByRole: actor.role, assignedAt: now },
    });
    if (claimed.count !== 1) throw new VisitRequestError("This request was already handled.", 409);

    let leadId: number;
    if (availability.lead === "OWN" && availability.ownLeadId) {
      leadId = availability.ownLeadId;
      await tx.salesLeadActivity.create({
        data: { leadId, createdById: actor.userId, type: "NOTE", description: `The owner asked NoLSAF for a visit (${request.publicRef}). Assigned to you by ${by}.` },
      });
    } else {
      const notes = [
        `Owner visit request ${request.publicRef}, assigned by ${by}.`,
        request.message ? `The owner wrote: ${request.message}` : null,
      ].filter(Boolean).join("\n");
      const lead = await tx.salesLead.create({
        data: {
          salesPartnerId: partner.id,
          propertyName: request.propertyName,
          contactPerson: request.contactName,
          contactPhone: request.contactPhone,
          contactEmail: request.contactEmail,
          location: request.location,
          region: regionName,
          propertyType: request.propertyType,
          estimatedRooms: request.estimatedRooms,
          proposedProduct: product,
          ...identity,
          duplicateReviewStatus: matches.length ? "POSSIBLE_DUPLICATE" : "CLEAR",
          duplicateEvidence: matches.length ? duplicateEvidence(matches, now) : null,
          nextFollowUpAt: new Date(now.getTime() + VISIT_FOLLOW_UP_HOURS * 3_600_000),
          notes,
          protectionStartsAt: now,
          protectionExpiresAt: new Date(now.getTime() + LEAD_PROTECTION_DAYS * DAY_MS),
        },
        select: { id: true },
      });
      leadId = lead.id;
      await tx.salesLeadActivity.create({
        data: { leadId, createdById: actor.userId, type: "NOTE", description: `Lead created from owner visit request ${request.publicRef}. Call the owner within ${VISIT_FOLLOW_UP_HOURS} hours.` },
      });
    }
    await tx.salesVisitRequest.update({ where: { id: request.id }, data: { leadId } });
    return { leadId, linkedExisting: availability.lead === "OWN" };
  });

  return {
    ...result,
    possibleDuplicate: matches.length > 0,
    partner: { id: partner.id, userId: partner.userId, agentCode: partner.agentCode, name: partner.user?.fullName || partner.user?.name || partner.agentCode },
  };
}

// ---------- closing ----------

export async function closeVisitRequest(db: any, request: any, reason: string, userId: number, now = new Date()) {
  if (request.status !== "NEW") throw new VisitRequestError("Only a request that is not assigned yet can be closed.", 409);
  const closed = await db.salesVisitRequest.updateMany({
    where: { id: request.id, status: "NEW" },
    data: { status: "CLOSED", closedReason: reason, closedById: userId, closedAt: now },
  });
  if (closed.count !== 1) throw new VisitRequestError("This request was already handled.", 409);
}

// ---------- views ----------

/** For the admin queue: everything, contact included. */
export function adminVisitView(row: any, extra: { regionName: string | null; partner: { code: string; name: string } | null }) {
  return {
    ref: row.publicRef,
    status: row.status,
    region: extra.regionName,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    propertyName: row.propertyName,
    propertyType: row.propertyType,
    estimatedRooms: row.estimatedRooms,
    location: row.location,
    interest: row.interest,
    message: row.message,
    assignedTo: extra.partner,
    assignedByRole: row.assignedByRole,
    assignedAt: row.assignedAt,
    closedReason: row.closedReason,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
  };
}

/**
 * For a Regional lead: enough to choose a partner, never the owner's phone or
 * email. Those go to the assigned partner through the lead.
 */
export function leadVisitView(row: any, partner: { code: string; name: string } | null) {
  return {
    ref: row.publicRef,
    status: row.status,
    contactName: row.contactName,
    propertyName: row.propertyName,
    propertyType: row.propertyType,
    estimatedRooms: row.estimatedRooms,
    location: row.location,
    interest: row.interest,
    message: row.message,
    assignedTo: partner,
    assignedAt: row.assignedAt,
    createdAt: row.createdAt,
  };
}

/** Partner code and name by partner id, for the views above. */
export async function partnerLabels(db: any, ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map<number, { code: string; name: string }>();
  const rows = await db.salesPartnerProfile.findMany({
    where: { id: { in: unique } },
    select: { id: true, agentCode: true, user: { select: { name: true, fullName: true } } },
  });
  return new Map<number, { code: string; name: string }>(
    rows.map((p: any) => [p.id, { code: p.agentCode, name: p.user?.fullName || p.user?.name || p.agentCode }]),
  );
}
