/**
 * NRMS Agent B2B — per-hotel relationship (NrmsAgentPropertyLink) management.
 *
 * This is the join layer: one row per (agency x hotel). Each hotel approves and
 * sets its own terms independently, and the admin-controlled `maxAgents` cap
 * lives here as an upsell lever — a hotel at its cap must contact NoLSAF.
 *
 * Verification gate: a hotel may INVITE any agency, but a link can only go ACTIVE
 * once NoLSAF has centrally VERIFIED that agency ("verify once, approve many").
 */
import { canActivatePartnership, canBookPartnership, type PartnershipPolicyResult } from "./nrmsPartnershipPolicy.js";

/** Link statuses that occupy an agent seat against the hotel's maxAgents cap. */
export const SEAT_CONSUMING_LINK_STATUSES = ["INVITED", "REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"] as const;
export type SuspensionAuthority = "HOTEL" | "ADMIN";

/** Serialize seat-cap decisions for one property. All invite/request entry
 * points take this lock before counting seats or creating a link. */
export async function lockAgentSeatAllocation(db: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> }, propertyId: number): Promise<void> {
  await db.$executeRawUnsafe("SELECT id FROM `owner_payg_account` WHERE `propertyId` = ? FOR UPDATE", propertyId);
}

/** Serialize a lifecycle change with any final booking authorization that
 * depends on the link remaining active. */
export async function lockAgentPartnership(db: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> }, linkId: number): Promise<void> {
  await db.$executeRawUnsafe("SELECT id FROM `nrms_agent_property_link` WHERE `id` = ? FOR UPDATE", linkId);
}

/** Final policy gate for approving a request-to-book hold. It locks both the
 * relationship and its billing account before loading current state, so a
 * suspension or dunning transition cannot race the confirmation. */
export async function authorizeHeldAgentBookingApproval(
  db: any,
  params: { linkId: number; propertyId: number },
): Promise<PartnershipPolicyResult> {
  await lockAgentPartnership(db, params.linkId);
  await lockAgentSeatAllocation(db, params.propertyId);
  const [link, payg] = await Promise.all([
    db.nrmsAgentPropertyLink.findUnique({
      where: { id: params.linkId },
      select: {
        status: true, initiatedBy: true, hotelConsentStatus: true, agentConsentStatus: true,
        agentAccount: { select: { status: true, verificationStatus: true } },
        property: { select: { status: true, nrmsActivatedAt: true } },
      },
    }),
    db.ownerPaygAccount.findUnique({ where: { propertyId: params.propertyId }, select: { status: true } }),
  ]);
  if (!link) return { ok: false, reason: "RELATIONSHIP_NOT_ACTIVE", message: "This partnership is no longer available." };
  return canBookPartnership({
    linkStatus: link.status,
    initiatedBy: link.initiatedBy,
    hotelConsentStatus: link.hotelConsentStatus,
    agentConsentStatus: link.agentConsentStatus,
    agencyStatus: link.agentAccount?.status,
    agencyVerificationStatus: link.agentAccount?.verificationStatus,
    propertyStatus: link.property?.status,
    propertyNrmsActivated: Boolean(link.property?.nrmsActivatedAt),
    paygStatus: payg?.status,
  });
}

type Db = {
  nrmsAgentPropertyLink: {
    count: (args: any) => Promise<number>;
    findFirst: (args: any) => Promise<any | null>;
    findUnique: (args: any) => Promise<any | null>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  nrmsAgentAccount: { findUnique: (args: any) => Promise<any | null> };
  ownerPaygAccount: { findUnique: (args: any) => Promise<any | null> };
  nrmsAgentRateAccess: { deleteMany: (args: any) => Promise<any>; createMany: (args: any) => Promise<any> };
};

/** Seats currently occupied at a hotel (INVITED + ACTIVE + SUSPENDED links). */
export async function countAgentSeats(db: Db, propertyId: number): Promise<number> {
  return db.nrmsAgentPropertyLink.count({
    where: { propertyId, status: { in: [...SEAT_CONSUMING_LINK_STATUSES] } },
  });
}

export type LinkTerms = {
  currency?: string;
  paymentTerms?: string; // PREPAID (v1)
  bookingMode?: string; // REQUEST | INSTANT
  creditLimit?: number;
};

export type AttachResult =
  | { ok: true; linkId: number }
  | { ok: false; reason: "AGENCY_NOT_FOUND" | "AGENCY_INACTIVE" | "ALREADY_LINKED" | "CAP_REACHED"; message: string };

/**
 * Attach (invite) an existing, already-created agency to a hotel. Enforces the
 * maxAgents cap and the one-link-per-(agency,hotel) rule. The link starts
 * INVITED; approval to ACTIVE is a separate, verification-gated step.
 */
export async function attachAgentToProperty(
  db: Db,
  params: {
    agentAccountId: number;
    propertyId: number;
    maxAgents: number;
    terms?: LinkTerms;
    initiatedBy?: "HOTEL" | "AGENT" | "ADMIN";
    requestedByUserId?: number | null;
    now?: Date;
  },
): Promise<AttachResult> {
  const agency = await db.nrmsAgentAccount.findUnique({ where: { id: params.agentAccountId }, select: { id: true, status: true } });
  if (!agency) return { ok: false, reason: "AGENCY_NOT_FOUND", message: "Agency not found." };
  if (String(agency.status || "ACTIVE").toUpperCase() !== "ACTIVE") return { ok: false, reason: "AGENCY_INACTIVE", message: "This agency identity is not active." };

  const existing = await db.nrmsAgentPropertyLink.findFirst({
    where: { agentAccountId: params.agentAccountId, propertyId: params.propertyId },
    select: { id: true, status: true },
  });
  if (existing) {
    // A REJECTED link can be re-invited; any live link is a duplicate.
    if (!["REJECTED", "TERMINATED"].includes(existing.status)) return { ok: false, reason: "ALREADY_LINKED", message: "This agency is already linked to the property." };
  }

  const seats = await countAgentSeats(db, params.propertyId);
  if (seats >= params.maxAgents) {
    return { ok: false, reason: "CAP_REACHED", message: "You have reached your approved-agent limit. Contact NoLSAF to increase it." };
  }

  const now = params.now ?? new Date();
  const initiatedBy = params.initiatedBy ?? "HOTEL";
  const initiatedByAgent = initiatedBy === "AGENT";
  const data = {
    status: initiatedByAgent ? "REQUESTED" : "INVITED",
    initiatedBy,
    requestedByUserId: params.requestedByUserId ?? null,
    requestedAt: now,
    hotelConsentStatus: initiatedByAgent ? "PENDING" : "ACCEPTED",
    hotelConsentedByUserId: initiatedByAgent ? null : (params.requestedByUserId ?? null),
    hotelConsentedAt: initiatedByAgent ? null : now,
    agentConsentStatus: initiatedByAgent ? "ACCEPTED" : "PENDING",
    agentConsentedByUserId: initiatedByAgent ? (params.requestedByUserId ?? null) : null,
    agentConsentedAt: initiatedByAgent ? now : null,
    activatedAt: null,
    suspendedAt: null,
    terminatedAt: null,
    suspensionAuthority: null,
    terminationReason: null,
    decidedByUserId: null,
    decidedAt: null,
    decisionReason: null,
    currency: params.terms?.currency ?? "TZS",
    paymentTerms: params.terms?.paymentTerms ?? "PREPAID",
    bookingMode: params.terms?.bookingMode ?? "REQUEST",
    creditLimit: params.terms?.creditLimit ?? 0,
  };
  const link = existing
    ? await db.nrmsAgentPropertyLink.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.nrmsAgentPropertyLink.create({ data: { agentAccountId: params.agentAccountId, propertyId: params.propertyId, ...data }, select: { id: true } });
  return { ok: true, linkId: link.id };
}

export type LinkTransition = "ACTIVE" | "SUSPENDED" | "REJECTED" | "TERMINATED";
export type TransitionResult =
  | { ok: true; status: LinkTransition; changed: boolean }
  | { ok: false; reason: "NOT_FOUND" | "AGENCY_NOT_VERIFIED" | "AGENT_NOT_ACCEPTED" | "HOTEL_NOT_ELIGIBLE" | "ADMIN_SUSPENSION_ACTIVE" | "INVALID_TRANSITION"; message: string };

/**
 * Approve (→ACTIVE), suspend (→SUSPENDED) or reject (→REJECTED) a link, scoped to
 * the owning property. Activation requires the agency to be centrally VERIFIED.
 */
export async function setAgentLinkStatus(
  db: Db,
  params: {
    linkId: number;
    propertyId: number;
    status: LinkTransition;
    decidedByUserId: number;
    reason?: string | null;
    suspensionAuthority?: SuspensionAuthority;
    allowAdminSuspensionOverride?: boolean;
  },
): Promise<TransitionResult> {
  const link = await db.nrmsAgentPropertyLink.findFirst({
    where: { id: params.linkId, propertyId: params.propertyId },
    select: {
      id: true, status: true, initiatedBy: true, hotelConsentStatus: true, agentConsentStatus: true, suspensionAuthority: true,
      agentAccount: { select: { status: true, verificationStatus: true } },
      property: { select: { status: true, nrmsActivatedAt: true } },
    },
  });
  if (!link) return { ok: false, reason: "NOT_FOUND", message: "Agent link not found." };

  // A repeated request must be an observable no-op. Callers use `changed` to
  // avoid writing duplicate audit rows or delivering the same notification.
  if (link.status === params.status) return { ok: true, status: params.status, changed: false };

  const now = new Date();
  if (params.status === "ACTIVE") {
    if (link.status === "SUSPENDED" && link.suspensionAuthority === "ADMIN" && !params.allowAdminSuspensionOverride) {
      return { ok: false, reason: "ADMIN_SUSPENSION_ACTIVE", message: "This partnership was suspended by NoLSAF and can only be resumed by an authorized administrator." };
    }
    const hotelConsentStatus = String(link.initiatedBy || "HOTEL").toUpperCase() === "AGENT" ? "ACCEPTED" : link.hotelConsentStatus;
    const payg = await db.ownerPaygAccount.findUnique({ where: { propertyId: params.propertyId }, select: { status: true } });
    const activation = canActivatePartnership({
      linkStatus: link.status,
      initiatedBy: link.initiatedBy,
      hotelConsentStatus,
      agentConsentStatus: link.agentConsentStatus,
      agencyStatus: link.agentAccount?.status,
      agencyVerificationStatus: link.agentAccount?.verificationStatus,
      propertyStatus: link.property?.status,
      propertyNrmsActivated: Boolean(link.property?.nrmsActivatedAt),
      paygStatus: payg?.status,
    });
    if (!activation.ok) {
      if (activation.reason === "AGENCY_NOT_VERIFIED") return { ok: false, reason: "AGENCY_NOT_VERIFIED", message: activation.message };
      if (activation.reason === "AGENT_CONSENT_REQUIRED") return { ok: false, reason: "AGENT_NOT_ACCEPTED", message: activation.message };
      if (["PROPERTY_INACTIVE", "PROPERTY_NRMS_INACTIVE", "PROPERTY_BILLING_BLOCKED"].includes(activation.reason)) {
        return { ok: false, reason: "HOTEL_NOT_ELIGIBLE", message: activation.message };
      }
      return { ok: false, reason: "INVALID_TRANSITION", message: activation.message };
    }
  }
  // Guard obviously-wrong moves.
  if (link.status === "REJECTED" && params.status !== "REJECTED") {
    return { ok: false, reason: "INVALID_TRANSITION", message: "Re-invite the agency before changing its status." };
  }
  const allowedSources: Record<LinkTransition, string[]> = {
    ACTIVE: ["REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"],
    SUSPENDED: ["ACTIVE", "SUSPENDED"],
    REJECTED: ["INVITED", "REQUESTED", "AGENT_ACCEPTED", "REJECTED"],
    TERMINATED: ["INVITED", "REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED", "TERMINATED"],
  };
  if (!allowedSources[params.status].includes(link.status)) {
    return { ok: false, reason: "INVALID_TRANSITION", message: `A ${link.status} partnership cannot move to ${params.status}.` };
  }

  const changed = await db.nrmsAgentPropertyLink.updateMany({
    // Compare-and-set closes the concurrent double-submit window. Only the
    // request that still owns the observed source state may publish the event.
    where: { id: link.id, status: link.status },
    data: {
      status: params.status,
      decidedByUserId: params.decidedByUserId,
      decidedAt: now,
      decisionReason: params.reason ?? null,
      ...(params.status === "ACTIVE" ? {
        hotelConsentStatus: "ACCEPTED",
        hotelConsentedByUserId: params.decidedByUserId,
        hotelConsentedAt: now,
        activatedAt: now,
        suspendedAt: null,
        suspensionAuthority: null,
      } : {}),
      ...(params.status === "SUSPENDED" ? { suspendedAt: now, suspensionAuthority: params.suspensionAuthority ?? "HOTEL" } : {}),
      ...(params.status === "REJECTED" ? {
        hotelConsentStatus: "DECLINED",
        hotelConsentedByUserId: params.decidedByUserId,
        hotelConsentedAt: now,
        suspensionAuthority: null,
      } : {}),
      ...(params.status === "TERMINATED" ? {
        terminatedAt: now,
        terminationReason: params.reason ?? null,
        suspensionAuthority: null,
      } : {}),
    },
  });
  return { ok: true, status: params.status, changed: changed.count === 1 };
}

/** Update a link's commercial terms, scoped to the owning property. */
export async function updateAgentLinkTerms(
  db: Db,
  params: { linkId: number; propertyId: number; terms: LinkTerms },
): Promise<{ ok: boolean }> {
  const changed = await db.nrmsAgentPropertyLink.updateMany({
    where: { id: params.linkId, propertyId: params.propertyId },
    data: {
      ...(params.terms.currency != null ? { currency: params.terms.currency } : {}),
      ...(params.terms.paymentTerms != null ? { paymentTerms: params.terms.paymentTerms } : {}),
      ...(params.terms.bookingMode != null ? { bookingMode: params.terms.bookingMode } : {}),
      ...(params.terms.creditLimit != null ? { creditLimit: params.terms.creditLimit } : {}),
    },
  });
  return { ok: changed.count === 1 };
}

/**
 * Replace the agent's rate/room access for a link (which rate plans + room types
 * the agent may sell at this hotel). Runs inside a transaction: delete then insert.
 */
export async function setAgentRateAccess(
  tx: Db,
  params: { linkId: number; propertyId: number; entries: Array<{ ratePlanId: number; roomTypeId: number | null }> },
): Promise<{ ok: boolean; reason?: "NOT_FOUND" }> {
  const link = await tx.nrmsAgentPropertyLink.findFirst({ where: { id: params.linkId, propertyId: params.propertyId }, select: { id: true } });
  if (!link) return { ok: false, reason: "NOT_FOUND" };
  await tx.nrmsAgentRateAccess.deleteMany({ where: { linkId: params.linkId } });
  if (params.entries.length) {
    // De-dupe so a repeated (ratePlan, roomType) pair cannot violate the unique index.
    const seen = new Set<string>();
    const rows = params.entries.filter((e) => {
      const key = `${e.ratePlanId}:${e.roomTypeId ?? "null"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((e) => ({ linkId: params.linkId, ratePlanId: e.ratePlanId, roomTypeId: e.roomTypeId }));
    await tx.nrmsAgentRateAccess.createMany({ data: rows });
  }
  return { ok: true };
}
