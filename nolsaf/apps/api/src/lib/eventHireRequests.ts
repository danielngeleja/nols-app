/** Private event enquiries. No bearer links, public writes, or payment side effects.
 * Rollout: review migration 20261127170000_event_hire_requests, apply only through
 * the approved release process, then regenerate Prisma. API and worker are off
 * unless EVENT_HIRE_REQUESTS_ENABLED=true. UI entry points additionally require
 * NEXT_PUBLIC_EVENT_HIRE_REQUESTS_ENABLED=true at web build time.
 * Booking, checkout, deposit and settlement logic lives in eventHireBookings.ts.
 * Apply the workspace migration as well before enabling operations. Payments
 * additionally require EVENT_HIRE_PAYMENTS_ENABLED and verified card settings.
 * Whole-house inventory and multi-day events remain outside this phase.
 * Verify concurrent holds/blocks against a migrated MySQL test database before
 * production activation; unit tests validate queries, not database isolation.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { EventHireError, EVENT_TYPES, sanitizeEventTerms, eventMoney, depositFor, isEventHireAvailable } from "./eventHire.js";
import { agencyGateFailure, loadAgencyGateInput } from "./salesAgency.js";
import { assertEventInventory, eventPaymentsEnabled } from "./eventHireBookings.js";
import { eventActorScope,effectiveEventStatus,lockEventProperty,EVENT_PENDING_STATUSES as pending,type EventActor } from "./eventHireShared.js";
export {eventActorScope,effectiveEventStatus,lockEventProperty,type EventActor} from "./eventHireShared.js";

export const requestBody = z.object({
  propertyId: z.number().int().positive(),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
  eventType: z.enum(EVENT_TYPES), people: z.number().int().min(1).max(3000),
  seating: z.enum(["SEATED", "STANDING"]), package: z.enum(["HALF_DAY", "FULL_DAY", "EVENING"]),
  assisted: z.boolean().default(true),
}).strict();
export const decisionBody = z.object({
  version: z.number().int().positive(),
  action: z.enum(["CONFIRM", "DECLINE", "CANCEL", "APPROVE", "RECORD_CALL", "VERIFY_CALL", "ASSIGN"]),
  partnerId: z.number().int().positive().optional(),
  note: z.string().trim().min(12).max(500).optional(),
  attested: z.literal(true).optional(),
}).strict();
export const blockBody = z.object({
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
  reason: z.enum(["EXTERNAL_BOOKING", "MAINTENANCE", "UNAVAILABLE"]),
}).strict();
export const validEventReference = (s: unknown) => typeof s === "string" && /^er_[A-Za-z0-9_-]{32}$/.test(s);
const reference = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
function fail(message: string, code: string, status = 409): never { throw new EventHireError(message, status, code); }
const hour = 3_600_000;

/** Operating hours: 09:00–18:00 EAT daily. Absolute expiry still applies overnight. */
export function addEventOperatingMinutes(date: Date, count: number): Date {
  let t = date.getTime();
  while (count > 0) {
    const local = new Date(t + 3 * hour);
    const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const opening = day + 6 * hour, closing = day + 15 * hour;
    if (t < opening) t = opening;
    if (t >= closing) { t = day + 24 * hour + 6 * hour; continue; }
    const used = Math.min(count, (closing - t) / 60_000);
    t += used * 60_000;
    count -= used;
  }
  return new Date(t);
}

async function agency(db: any, partnerId: number, now: Date) {
  if (agencyGateFailure(await loadAgencyGateInput(db, partnerId, now), { at: now })) fail("Agency access unavailable.", "AGENCY_UNAVAILABLE", 404);
}

export function quoteEventRequest(offering: any, input: z.infer<typeof requestBody>, now = new Date()) {
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  const duration = endsAt.getTime() - startsAt.getTime();
  if (startsAt <= now || startsAt.getUTCSeconds() || startsAt.getUTCMilliseconds() || endsAt.getUTCSeconds() || endsAt.getUTCMilliseconds() || startsAt.getTime() > now.getTime() + 366 * 24 * hour || duration <= 0 || duration > 18 * hour) {
    fail("Choose a future event lasting at most 18 hours.", "INVALID_TIME", 400);
  }
  const terms = sanitizeEventTerms(offering.terms);
  // Whole-house events share inventory with accommodation; that inventory must
  // be integrated before selling the whole house through this workflow.
  if (terms.spaceType === "WHOLE_HOUSE") fail("Whole-house event availability needs NoLSAF assistance.", "SHARED_INVENTORY");
  if (!terms.eventTypes.includes(input.eventType)) fail("This event type is not offered.", "EVENT_TYPE", 400);
  const capacity = input.seating === "SEATED" ? terms.capacitySeated : terms.capacityStanding;
  if (!capacity || input.people > capacity) fail("The guest count exceeds this space's capacity.", "CAPACITY", 400);
  if (!terms.earliestStart || !terms.latestEnd) fail("Event hours are unavailable.", "HOURS");
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const local = new Date(startsAt.getTime() + 3 * hour);
  const at = local.getUTCHours() * 60 + local.getUTCMinutes();
  const opening = mins(terms.earliestStart), closing = mins(terms.latestEnd);
  const window = (closing - opening + 1440) % 1440 || 1440;
  const offset = (at - opening + 1440) % 1440;
  if (offset + duration / 60_000 > window) fail("Choose a time within the owner's event hours.", "HOURS", 400);
  if (input.package === "HALF_DAY" && duration > 5 * hour) fail("Half-day hire is up to five hours.", "PACKAGE", 400);
  if (input.package === "EVENING" && (at < 17 * 60 || duration > 6 * hour)) fail("Evening hire starts from 17:00 and lasts up to six hours.", "PACKAGE", 400);
  const price = input.package === "HALF_DAY" ? terms.halfDayPrice : input.package === "FULL_DAY" ? terms.fullDayPrice : terms.eveningPrice;
  if (!price) fail("This hire package is not offered.", "PACKAGE", 400);
  const money = eventMoney(price);
  const deposit = depositFor(terms, price), cleaningFee = terms.cleaningFee ?? 0;
  if (deposit === null) fail("The venue deposit is not configured.", "DEPOSIT");
  return { ...money, deposit, cleaningFee, total: money.clientPays + deposit + cleaningFee, currency: "TZS" };
}

const transaction = (db: any, fn: (tx: any) => Promise<any>) => db.$transaction(fn, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 });

async function assertSpaceFree(tx: any, propertyId: number, startsAt: Date, endsAt: Date, now: Date, exceptId?: number) {
  await assertEventInventory(tx, propertyId, startsAt, endsAt, now, exceptId);
  const overlap = { propertyId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } };
  const block = await tx.eventHireBlock.findFirst({ where: { ...overlap, cancelledAt: null }, select: { id: true } });
  const hold = await tx.eventHireRequest.findFirst({ where: {
    ...overlap, ...(exceptId ? { id: { not: exceptId } } : {}),
    status: { in: ["OWNER_CONFIRMED", "READY_TO_PAY", "PAYMENT_PENDING"] }, holdExpiresAt: { gt: now }, expiresAt: { gt: now },
  }, select: { id: true } });
  if (block || hold) fail("This time is no longer available. Choose another time.", "UNAVAILABLE");
}

async function offeringFor(tx: any, propertyId: number) {
  const property = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true, ownerId: true, title: true, status: true, rentalMode: true, eventHire: true } });
  if (!property || !isEventHireAvailable(property.eventHire, property) || property.eventHire.approvedFingerprint !== property.eventHire.termsFingerprint) {
    fail("This event venue is unavailable.", "VENUE_UNAVAILABLE", 404);
  }
  return property;
}

async function event(tx: any, row: any, actor: EventActor | null, action: string, details: any = {}) {
  await tx.eventHireRequestEvent.create({ data: { requestId: row.id, actorUserId: actor?.userId ?? null, action, details } });
}
async function inbox(tx: any, userId: number, row: any, body: string, href: string) {
  await tx.notification.create({ data: { userId, type: "booking", title: "Event hire request", body,
    meta: { notificationKind: "event_hire_request", reference: row.reference, href } } });
}
async function notifyDecision(tx: any, row: any, property: any, body: string) {
  await inbox(tx, row.clientUserId, row, body, "/account/event-requests");
  await inbox(tx, property.ownerId, row, body, "/owner/event-requests");
  if (row.salesPartnerId) {
    const partner = await tx.salesPartnerProfile.findUnique({ where: { id: row.salesPartnerId }, select: { userId: true } });
    if (partner) await inbox(tx, partner.userId, row, body, "/sales/event-requests");
  }
}
async function notifyDesk(tx: any, row: any, body: string) {
  const admins = await tx.user.findMany({ where: { role: "ADMIN" }, select: { id: true }, take: 100 });
  for (const admin of admins) await inbox(tx, admin.id, row, body, "/admin/event-hire/requests");
}

export async function createEventRequest(db: any, actor: EventActor, raw: unknown, now = new Date()) {
  if (actor.kind !== "CLIENT") fail("Not found", "NOT_FOUND", 404);
  const parsed = requestBody.safeParse(raw);
  if (!parsed.success) fail("Check the event request details.", "INVALID_REQUEST", 400);
  const input = parsed.data!;
  return transaction(db, async (tx) => {
    // Account lock prevents concurrent submissions bypassing the active-request cap.
    await tx.$queryRaw`SELECT id FROM user WHERE id = ${actor.userId} FOR UPDATE`;
    const client = await tx.user.findUnique({ where: { id: actor.userId }, select: { phoneVerifiedAt: true } });
    if (!client?.phoneVerifiedAt) fail("Verify your phone before requesting a venue.", "PHONE_REQUIRED", 403);
    if (await tx.eventHireRequest.count({ where: { clientUserId: actor.userId, status: { in: pending }, expiresAt: { gt: now }, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] } }) >= 5) {
      fail("You already have five open venue requests.", "REQUEST_LIMIT", 429);
    }
    await lockEventProperty(tx, input.propertyId);
    const property = await offeringFor(tx, input.propertyId);
    if (property.ownerId === actor.userId) fail("You cannot request your own venue.", "SELF_BOOKING", 403);
    const quote = quoteEventRequest(property.eventHire, input, now);
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    await assertSpaceFree(tx, property.id, startsAt, endsAt, now);
    const duplicate = await tx.eventHireRequest.findFirst({ where: { propertyId: property.id, clientUserId: actor.userId,
      startsAt, endsAt, status: { in: pending }, expiresAt: { gt: now } } });
    if (duplicate && effectiveEventStatus(duplicate, now) !== "EXPIRED") return duplicate;
    const urgent = startsAt.getTime() - now.getTime() < 24 * hour;
    const row = await tx.eventHireRequest.create({ data: {
      reference: reference("er"), propertyId: property.id, clientUserId: actor.userId, assisted: input.assisted,
      startsAt, endsAt, expiresAt: new Date(Math.min(now.getTime() + 24 * hour, startsAt.getTime())),
      eventType: input.eventType, people: input.people, seating: input.seating, package: input.package,
      termsFingerprint: property.eventHire.termsFingerprint, quote, termsSnapshot: sanitizeEventTerms(property.eventHire.terms),
      reminderAt: addEventOperatingMinutes(now, 30), escalateAt: urgent ? now : addEventOperatingMinutes(now, 120),
    } });
    await event(tx, row, actor, "REQUESTED", { assisted: input.assisted });
    await notifyDecision(tx, row, property, "A venue has been requested. Availability must be confirmed before payment.");
    if (input.assisted || urgent) await notifyDesk(tx, row, "A venue request needs NoLSAF assistance. Assign an Agency Desk partner.");
    return row;
  });
}

export async function decideEventRequest(db: any, actor: EventActor, ref: string, raw: unknown, now = new Date()) {
  if (!validEventReference(ref)) fail("Not found", "NOT_FOUND", 404);
  const parsed = decisionBody.safeParse(raw);
  if (!parsed.success) fail("Check the decision details.", "INVALID_DECISION", 400);
  const input = parsed.data!;
  return transaction(db, async (tx) => {
    if (actor.kind === "PARTNER") await agency(tx, actor.partnerId!, now);
    const scope = eventActorScope(actor);
    let row = await tx.eventHireRequest.findFirst({ where: { reference: ref, ...scope } });
    if (!row) fail("Not found", "NOT_FOUND", 404);
    await lockEventProperty(tx, row.propertyId);
    // Re-read after acquiring lock, with authorisation scope, not a stale pre-lock row.
    row = await tx.eventHireRequest.findFirst({ where: { reference: ref, ...scope } });
    if (!row) fail("Not found", "NOT_FOUND", 404);
    if (row.version !== input.version) fail("This request changed. Refresh before deciding.", "CHANGED");
    if (!pending.includes(effectiveEventStatus(row, now))) fail("This request is closed or expired.", "CLOSED");
    if (row.status === "PAYMENT_PENDING") fail("Payment is being checked. Manage cancellation from the booking after reconciliation.", "PAYMENT_PENDING");
    const property = await tx.property.findUnique({ where: { id: row.propertyId }, select: { id: true, ownerId: true, title: true } });
    let data: any = {};
    if (input.action === "CANCEL" && actor.kind === "CLIENT") data = { status: "CANCELLED", holdExpiresAt: null };
    else if (input.action === "DECLINE" && actor.kind === "OWNER") data = { status: "DECLINED", holdExpiresAt: null };
    else if (input.action === "ASSIGN" && actor.kind === "ADMIN" && input.partnerId && row.assisted && !row.partnerApprovedAt) {
      await agency(tx, input.partnerId, now);
      const partner = await tx.salesPartnerProfile.findUnique({ where: { id: input.partnerId }, select: { userId: true } });
      if (!partner || [property.ownerId, row.clientUserId].includes(partner.userId)) fail("Assign an independent sales partner.", "SELF_APPROVAL", 403);
      data = { salesPartnerId: input.partnerId };
    } else if ((input.action === "CONFIRM" && actor.kind === "OWNER") || (input.action === "RECORD_CALL" && actor.kind === "PARTNER")) {
      const acknowledgingCall = actor.kind === "OWNER" && row.status === "OWNER_CONFIRMED" && row.confirmationVia === "PARTNER_CALL";
      if (row.status !== "WAITING_OWNER" && !acknowledgingCall) fail("Availability has already been decided.", "CHANGED");
      if (actor.kind === "PARTNER" && (!input.attested || !input.note)) fail("Record who confirmed availability and the call details.", "EVIDENCE_REQUIRED", 400);
      const current = await offeringFor(tx, row.propertyId);
      if (current.eventHire.termsFingerprint !== row.termsFingerprint) fail("Venue terms changed. Request a fresh quote.", "TERMS_CHANGED");
      await assertSpaceFree(tx, row.propertyId, row.startsAt, row.endsAt, now, row.id);
      data = { status: row.assisted ? "OWNER_CONFIRMED" : "READY_TO_PAY", ownerConfirmedAt: now,
        confirmedOwnerId: property.ownerId, confirmationVia: actor.kind === "OWNER" ? "APP" : "PARTNER_CALL",
        holdExpiresAt: acknowledgingCall ? row.holdExpiresAt : new Date(Math.min(now.getTime() + hour, new Date(row.expiresAt).getTime())) };
    } else if (input.action === "VERIFY_CALL" && actor.kind === "ADMIN" && row.status === "OWNER_CONFIRMED" && row.confirmationVia === "PARTNER_CALL") {
      if (!input.attested || !input.note) fail("Record your independent call with the owner.", "EVIDENCE_REQUIRED", 400);
      const assigned = await tx.salesPartnerProfile.findUnique({ where: { id: row.salesPartnerId }, select: { userId: true } });
      if ([property.ownerId, row.clientUserId, assigned?.userId].includes(actor.userId)) fail("An independent NoLSAF reviewer is required.", "SELF_APPROVAL", 403);
      const current = await offeringFor(tx, row.propertyId);
      if (current.ownerId !== row.confirmedOwnerId || current.eventHire.termsFingerprint !== row.termsFingerprint) fail("Venue approval changed.", "TERMS_CHANGED");
      data = { confirmationVia: "DESK_CALL" };
    } else if (input.action === "APPROVE" && actor.kind === "PARTNER" && row.assisted && row.status === "OWNER_CONFIRMED") {
      if (!input.attested) fail("Confirm that you checked the owner's availability.", "EVIDENCE_REQUIRED", 400);
      // A partner cannot unilaterally both record a call and approve it. Owner
      // acknowledgement or an independent NoLSAF callback is required.
      if (!["APP", "DESK_CALL"].includes(row.confirmationVia)) fail("The owner or an independent NoLSAF reviewer must acknowledge the recorded call before payment.", "OWNER_ACK_REQUIRED");
      const current = await offeringFor(tx, row.propertyId);
      if (current.ownerId !== row.confirmedOwnerId || current.eventHire.termsFingerprint !== row.termsFingerprint) fail("Venue approval changed.", "TERMS_CHANGED");
      await assertSpaceFree(tx, row.propertyId, row.startsAt, row.endsAt, now, row.id);
      data = { status: "READY_TO_PAY", partnerApprovedAt: now,
        holdExpiresAt: new Date(Math.min(now.getTime() + 30 * 60_000, new Date(row.holdExpiresAt).getTime())) };
    } else fail("This action is not permitted.", "FORBIDDEN", 403);
    const updated = await tx.eventHireRequest.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } });
    await event(tx, row, actor, input.action, { from: row.status, to: updated.status, ...(input.note ? { note: input.note } : {}), ...(input.partnerId ? { partnerId: input.partnerId } : {}) });
    await notifyDecision(tx, updated, property, `Event request: ${updated.status.toLowerCase().replace(/_/g, " ")}. Check the request for details.`);
    return updated;
  });
}

export async function createEventBlock(db: any, actor: EventActor, propertyId: number, raw: unknown, now = new Date()) {
  const parsed = blockBody.safeParse(raw);
  if (!parsed.success) fail("Check the blocked time.", "INVALID_BLOCK", 400);
  const startsAt = new Date(parsed.data!.startsAt), endsAt = new Date(parsed.data!.endsAt);
  if (actor.kind !== "OWNER" || endsAt <= startsAt || endsAt <= now || endsAt.getTime() - startsAt.getTime() > 366 * 24 * hour) fail("Check the blocked time.", "INVALID_BLOCK", 400);
  return transaction(db, async (tx) => {
    await lockEventProperty(tx, propertyId);
    const property = await tx.property.findFirst({ where: { id: propertyId, ownerId: actor.userId }, select: { id: true } });
    if (!property) fail("Not found", "NOT_FOUND", 404);
    await assertSpaceFree(tx, propertyId, startsAt, endsAt, now);
    return tx.eventHireBlock.create({ data: { reference: reference("eb"), propertyId, startsAt, endsAt, reason: parsed.data!.reason, createdById: actor.userId } });
  });
}

/** Explicit allowlist: IDs, owner contacts and call notes never leak to clients. */
export function eventRequestView(row: any, now = new Date()) {
  const status = effectiveEventStatus(row, now);
  return { reference: row.reference, version: row.version, status, assisted: row.assisted,
    propertyTitle: row.property?.title, startsAt: row.startsAt, endsAt: row.endsAt,
    eventType: row.eventType, people: row.people, seating: row.seating, package: row.package,
    quote: row.quote, terms: row.termsSnapshot, expiresAt: row.expiresAt, holdExpiresAt: row.holdExpiresAt,
    ownerConfirmedAt: row.ownerConfirmedAt, confirmationVia: row.confirmationVia,
    partnerAssigned: Boolean(row.salesPartnerId), partnerApprovedAt: row.partnerApprovedAt,
    needsAssistance: status === "WAITING_OWNER" && new Date(row.escalateAt) <= now,
    // There is deliberately no checkout route until event payments, deposit
    // accounting and callback reconciliation are integrated.
    canPay: eventPaymentsEnabled() && status === "READY_TO_PAY",
  };
}

/** Durable reminders, escalation and expiry; repeated or concurrent worker runs
 * cannot duplicate a decision because each request rechecks under its venue lock. */
export async function runEventRequestLifecycle(db: any, now = new Date()) {
  const rows = await db.eventHireRequest.findMany({ where: { status: { in: pending }, OR: [
    { expiresAt: { lte: now } }, { holdExpiresAt: { lte: now } },
    { status: "WAITING_OWNER", remindedAt: null, reminderAt: { lte: now } },
    { status: "WAITING_OWNER", escalatedAt: null, escalateAt: { lte: now } },
  ] }, select: { id: true, propertyId: true }, orderBy: { createdAt: "asc" }, take: 100 });
  for (const candidate of rows) await transaction(db, async (tx) => {
    await lockEventProperty(tx, candidate.propertyId);
    const row = await tx.eventHireRequest.findUnique({ where: { id: candidate.id } });
    if (!row || !pending.includes(row.status)) return;
    const property = await tx.property.findUnique({ where: { id: row.propertyId }, select: { ownerId: true } });
    if (effectiveEventStatus(row, now) === "EXPIRED") {
      await tx.eventHireRequest.update({ where: { id: row.id }, data: { status: "EXPIRED", holdExpiresAt: null, version: { increment: 1 } } });
      await event(tx, row, null, "EXPIRED");
      await notifyDecision(tx, row, property, "The event request or availability hold expired. No payment was taken.");
      return;
    }
    if (row.status !== "WAITING_OWNER") return;
    if (!row.remindedAt && new Date(row.reminderAt) <= now) {
      await tx.eventHireRequest.update({ where: { id: row.id }, data: { remindedAt: now } });
      await event(tx, row, null, "OWNER_REMINDER");
      await inbox(tx, property.ownerId, row, "Please confirm or decline the requested event time.", "/owner/event-requests");
    }
    if (!row.escalatedAt && new Date(row.escalateAt) <= now) {
      await tx.eventHireRequest.update({ where: { id: row.id }, data: { escalatedAt: now } });
      await event(tx, row, null, "ESCALATED");
      await notifyDesk(tx, row, "Owner confirmation is overdue or the event is urgent. Contact the owner or offer an alternative venue.");
      await notifyDecision(tx, row, property, "NoLSAF assistance is needed to confirm this venue. Payment remains closed.");
    }
  });
  return rows.length;
}
