/**
 * Long stay for an assisted listing (docs/LONG_STAY_RENTALS.md section 15).
 *
 * A Sales Partner listing a home for an owner asks NoLSAF to switch long stay
 * on for that owner. While the request is PENDING the partner may draft the
 * monthly terms; submitting still needs the owner's switch (the existing
 * longStaySubmitRefusal). Approval creates the owner's LongStayLandlordGrant:
 * per owner, not per property. Every rule lives here so the partner route and
 * the admin route cannot drift apart.
 */
import crypto from "node:crypto";
import { isLongStayPropertyType } from "./fees.js";
import { landlordGate } from "./listing.js";

export const ACCESS_REQUEST_STATUSES = ["PENDING", "APPROVED", "DECLINED", "WITHDRAWN"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

/** Assisted listing states the partner can still edit, so may still ask. */
const EDITABLE_LISTING = ["DRAFTING", "RETURNED"];
/** Assisted listing states that can still be approved for long stay. */
const APPROVABLE_LISTING = ["DRAFTING", "RETURNED", "SUBMITTED"];

export class AccessRequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function newAccessRequestRef(): string {
  return `lr_${crypto.randomBytes(16).toString("base64url").slice(0, 22)}`;
}

export function isAccessRequestRef(value: unknown): value is string {
  return typeof value === "string" && /^lr_[A-Za-z0-9_-]{22}$/.test(value);
}

/** What the partner sees on the assisted listing. */
export type LongStayAccessView = {
  /** Long stay is switched on for this owner, so terms can be saved and submitted. */
  granted: boolean;
  paused: boolean;
  pauseReason: string | null;
  /** The home type can rent long stay at all. */
  homeTypeAllowed: boolean;
  request: { ref: string; status: string; reason: string; createdAt: Date; decidedAt: Date | null; decisionNote: string | null } | null;
};

export async function longStayAccessView(db: any, assisted: { id: number; ownerUserId: number; property?: { type?: string | null } | null }): Promise<LongStayAccessView> {
  const [gate, request] = await Promise.all([
    landlordGate(db, assisted.ownerUserId),
    db.longStayAccessRequest.findFirst({
      where: { assistedListingId: assisted.id },
      orderBy: { id: "desc" },
      select: { publicRef: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionNote: true },
    }),
  ]);
  return {
    granted: gate.granted,
    paused: gate.paused,
    pauseReason: gate.pauseReason,
    homeTypeAllowed: isLongStayPropertyType(assisted.property?.type ?? ""),
    request: request
      ? { ref: request.publicRef, status: request.status, reason: request.reason, createdAt: request.createdAt, decidedAt: request.decidedAt, decisionNote: request.decisionNote }
      : null,
  };
}

/** The partner's request. Idempotent: an open request for the listing is returned, not duplicated. */
export async function requestLongStayAccess(db: any, input: { assistedId: number; salesPartnerId: number; reason: string }) {
  const reason = String(input.reason || "").trim();
  if (reason.length < 10) throw new AccessRequestError("Say in a sentence why this owner wants long-stay tenants.");
  const assisted = await db.salesAssistedListing.findUnique({
    where: { id: input.assistedId },
    select: { id: true, status: true, salesPartnerId: true, propertyId: true, ownerUserId: true, property: { select: { type: true, title: true } } },
  });
  if (!assisted || assisted.salesPartnerId !== input.salesPartnerId) throw new AccessRequestError("Listing not found.", 404);
  if (!EDITABLE_LISTING.includes(assisted.status)) throw new AccessRequestError("Long stay can be requested only while you are still preparing the listing.", 409);
  if (!isLongStayPropertyType(assisted.property?.type ?? "")) {
    throw new AccessRequestError("Long stays are for houses, apartments, condos, villas, townhouses and bungalows.", 409);
  }
  const gate = await landlordGate(db, assisted.ownerUserId);
  if (gate.paused) throw new AccessRequestError(`Long stays are paused for this owner${gate.pauseReason ? `: ${gate.pauseReason}` : ""}. Contact NoLSAF.`, 409);
  if (gate.granted) return { created: false, alreadyGranted: true, request: null };

  const open = await db.longStayAccessRequest.findFirst({ where: { assistedListingId: assisted.id, status: "PENDING" } });
  if (open) return { created: false, alreadyGranted: false, request: open };

  const request = await db.longStayAccessRequest.create({
    data: {
      publicRef: newAccessRequestRef(),
      assistedListingId: assisted.id,
      propertyId: assisted.propertyId,
      ownerUserId: assisted.ownerUserId,
      salesPartnerId: input.salesPartnerId,
      reason: reason.slice(0, 500),
      status: "PENDING",
    },
  });
  return { created: true, alreadyGranted: false, request, propertyTitle: assisted.property?.title ?? null };
}

/**
 * Admin decision. APPROVED switches long stay on for the owner (per owner);
 * DECLINED needs a note. Only a PENDING request can be decided, once.
 */
export async function decideLongStayAccess(db: any, input: { ref: string; adminId: number; decision: "APPROVED" | "DECLINED"; note: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const note = input.note ? String(input.note).trim().slice(0, 300) : null;
  if (input.decision === "DECLINED" && (!note || note.length < 10)) throw new AccessRequestError("Give the partner a reason of at least 10 characters.");
  const request = await db.longStayAccessRequest.findUnique({ where: { publicRef: input.ref } });
  if (!request) throw new AccessRequestError("Request not found.", 404);
  if (request.status !== "PENDING") throw new AccessRequestError(`This request was already ${String(request.status).toLowerCase()}.`, 409);

  if (input.decision === "APPROVED") {
    const [assisted, owner] = await Promise.all([
      db.salesAssistedListing.findUnique({ where: { id: request.assistedListingId }, select: { status: true } }),
      db.user.findUnique({ where: { id: request.ownerUserId }, select: { role: true, suspendedAt: true, deletedAt: true } }),
    ]);
    if (!assisted || !APPROVABLE_LISTING.includes(assisted.status)) {
      throw new AccessRequestError("This listing is paused, cancelled or already live through another path. Review it before switching long stay on.", 409);
    }
    if (!owner || owner.role !== "OWNER" || owner.suspendedAt || owner.deletedAt) {
      throw new AccessRequestError("A suspended or closed account cannot be switched on.", 409);
    }
  }

  const claimed = await db.longStayAccessRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: input.decision, decidedById: input.adminId, decidedAt: now, decisionNote: note },
  });
  if (claimed.count !== 1) throw new AccessRequestError("This request changed a moment ago. Refresh.", 409);

  if (input.decision === "APPROVED") {
    // Same effect as the admin owner page's ENABLE, recorded as coming from this request.
    await db.longStayLandlordGrant.upsert({
      where: { userId: request.ownerUserId },
      create: { userId: request.ownerUserId, enabledById: input.adminId, enabledAt: now, note: `Approved from partner request ${request.publicRef}` },
      update: { pausedAt: null, pauseReason: null, enabledById: input.adminId, note: `Approved from partner request ${request.publicRef}` },
    });
  }
  return { request: { ...request, status: input.decision, decidedAt: now, decisionNote: note } };
}

/**
 * The owner objected and an admin cancelled the listing. If long stay was
 * switched on only because of this listing's request, and the owner has no
 * other long-stay home, the switch is removed: they never agreed to it.
 * A switch an admin gave any other way is left alone.
 */
export async function revokeLongStayFromCancelledListing(db: any, assistedListingId: number, ownerUserId: number, propertyId: number) {
  await withdrawLongStayRequests(db, assistedListingId);
  const approved = await db.longStayAccessRequest.findFirst({ where: { assistedListingId, status: "APPROVED" }, select: { publicRef: true } });
  if (!approved) return { revoked: false };
  const grant = await db.longStayLandlordGrant.findUnique({ where: { userId: ownerUserId }, select: { note: true } });
  if (!grant || !String(grant.note || "").includes(approved.publicRef)) return { revoked: false };
  const otherHomes = await db.property.count({ where: { ownerId: ownerUserId, rentalMode: "LONG_STAY", id: { not: propertyId } } });
  if (otherHomes > 0) return { revoked: false };
  await db.longStayLandlordGrant.delete({ where: { userId: ownerUserId } });
  return { revoked: true };
}

export type SettledRequest = { id: number; publicRef: string; salesPartnerId: number; propertyId: number; assistedListingId: number };

/**
 * Long stay is switched on per owner, for all their homes. Once it is on (one
 * request approved, or the owner page switch), every other waiting request for
 * that owner is settled as approved, so no partner waits on a decision that was
 * already made. Returns the requests it settled, for the caller to notify.
 */
export async function settleRequestsForSwitchedOnOwner(db: any, input: { ownerUserId: number; adminId: number | null; note: string; now?: Date }): Promise<SettledRequest[]> {
  const now = input.now ?? new Date();
  const waiting: SettledRequest[] = await db.longStayAccessRequest.findMany({
    where: { ownerUserId: input.ownerUserId, status: "PENDING" },
    select: { id: true, publicRef: true, salesPartnerId: true, propertyId: true, assistedListingId: true },
  });
  if (!waiting.length) return [];
  await db.longStayAccessRequest.updateMany({
    where: { id: { in: waiting.map((r) => r.id) }, status: "PENDING" },
    data: { status: "APPROVED", decidedById: input.adminId, decidedAt: now, decisionNote: input.note.slice(0, 300) },
  });
  return waiting;
}

/**
 * Settles waiting requests whose owner already has long stay on (and not
 * paused), e.g. switched on before this request or by a path that did not
 * settle it. Safe to run on every list load.
 */
export async function settleRequestsAlreadySwitchedOn(db: any, now = new Date()): Promise<SettledRequest[]> {
  const waiting = await db.longStayAccessRequest.findMany({ where: { status: "PENDING" }, select: { ownerUserId: true }, take: 500 });
  const owners = [...new Set(waiting.map((r: any) => r.ownerUserId))];
  if (!owners.length) return [];
  const on = await db.longStayLandlordGrant.findMany({ where: { userId: { in: owners }, pausedAt: null }, select: { userId: true } });
  const settled: SettledRequest[] = [];
  for (const grant of on) {
    settled.push(...await settleRequestsForSwitchedOnOwner(db, { ownerUserId: grant.userId, adminId: null, note: "Long stay was already on for this owner.", now }));
  }
  return settled;
}

/** A listing that is cancelled or objected to takes its waiting request with it. */
export async function withdrawLongStayRequests(db: any, assistedListingId: number, now = new Date()) {
  return db.longStayAccessRequest.updateMany({
    where: { assistedListingId, status: "PENDING" },
    data: { status: "WITHDRAWN", decidedAt: now, decisionNote: "The listing was paused or cancelled." },
  });
}
