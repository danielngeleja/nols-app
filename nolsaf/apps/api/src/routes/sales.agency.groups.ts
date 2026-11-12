/**
 * Agency Desk, phase 2, partner side: client book and group stays.
 *
 * Clients
 *   GET   /api/sales/agency/clients
 *   POST  /api/sales/agency/clients
 *   GET   /api/sales/agency/clients/:ref
 *   PATCH /api/sales/agency/clients/:ref
 *   POST  /api/sales/agency/clients/:ref/activities
 * Group stays
 *   GET   /api/sales/agency/groups
 *   POST  /api/sales/agency/groups                 prepare a request, SMS the client to confirm
 *   GET   /api/sales/agency/groups/:ref            request, booking progress and owner bids
 *   POST  /api/sales/agency/groups/:ref/resend     new confirmation link (old one stops working)
 *   POST  /api/sales/agency/groups/:ref/cancel     only before the client confirms
 *   POST  /api/sales/agency/groups/:ref/invite     ask listed owners to bid
 *   POST  /api/sales/agency/groups/:ref/shortlist  up to three bids for the client to choose from
 *   POST  /api/sales/agency/groups/:ref/message    message the client in the group thread
 *   POST  /api/sales/agency/groups/:ref/leads      flag an unlisted property (own sales lead) for fast-track onboarding
 *
 * Every route answers 404 unless the session's partner holds the Agency Desk
 * (requireAgencyDesk). Partners never set prices, never award a bid and never
 * touch payment: owners price, the client chooses and pays NoLSAF.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireWorkspaceAccess } from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { sendSms } from "../lib/sms.js";
import { getEffectiveCommissionPercent } from "../lib/accommodationPayout.js";
import { leadRef, resolvePartnerLead } from "../lib/salesReference.js";
import { loadPartnerIdentity, partnerOwnsPropertyReason, phoneKey } from "../lib/salesSelfDealing.js";
import { maskClientPhone, propertyKeyFromInput } from "../lib/salesAgency.js";
import {
  CLIENT_ACTIVITY_TYPES,
  CLIENT_BOOK_LIMIT,
  CLIENT_TYPES,
  GROUP_BIDDING_DAYS_MAX,
  GROUP_BIDDING_DAYS_MIN,
  GROUP_INVITE_MAX,
  GROUP_REQUEST_LINK_HOURS,
  GROUP_SHORTLIST_MAX,
  customerTotalFor,
  findProtectedConflict,
  newClientReference,
  newGroupRequestReference,
  newGroupRequestToken,
  normalizeEmail,
  normalizeName,
  parseGroupPayload,
  protectionUntil,
  shortlistNeedsReview,
} from "../lib/salesAgencyGroups.js";
import { requireAgencyDesk } from "./sales.agency.js";

const router = Router();
const db = prisma as any;
const NOT_FOUND = { error: "Not found" };
const HOUR_MS = 60 * 60 * 1000;
const MAX_OPEN_REQUESTS = 20;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"));

function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

const refPattern = (prefix: string) => new RegExp(`^${prefix}_[a-f0-9]{20}$`);
const isClientRef = (v: unknown) => refPattern("sc").test(String(v || ""));
const isGroupRef = (v: unknown) => refPattern("gr").test(String(v || ""));

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const clean = (v: string | null | undefined, max: number) => (v ? sanitizeText(v).slice(0, max) || null : null);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function serializeClient(c: any, now = new Date()) {
  return {
    reference: c.reference,
    type: c.type,
    name: c.name,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    region: c.region,
    notes: c.notes,
    status: c.status,
    protectedUntil: c.protectionExpiresAt,
    protectionActive: !!c.protectionExpiresAt && new Date(c.protectionExpiresAt).getTime() > now.getTime(),
    possibleDuplicate: c.duplicateReviewStatus === "POSSIBLE_DUPLICATE",
    createdAt: c.createdAt,
  };
}

async function ownClient(partnerId: number, reference: unknown) {
  if (!isClientRef(reference)) return null;
  return db.salesClientAccount.findFirst({ where: { reference: String(reference), salesPartnerId: partnerId } });
}

router.get("/agency/clients", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const q = normalizeName(req.query.q);
  const rows = await db.salesClientAccount.findMany({
    where: { salesPartnerId: req.agency.salesPartnerId, ...(q ? { nameNormalized: { contains: q } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return res.json({ items: rows.map((c: any) => serializeClient(c)) });
}) as RequestHandler);

const clientSchema = z.object({
  type: z.enum(CLIENT_TYPES),
  name: text(200).min(2),
  contactName: optText(160),
  phone: optText(40),
  email: optText(190),
  region: optText(120),
  notes: optText(2000),
}).strict();

router.post("/agency/clients", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the client details", details: parsed.error.issues });
  const input = parsed.data;
  const partnerId = req.agency.salesPartnerId;
  const now = new Date();
  const key = phoneKey(input.phone);
  const email = normalizeEmail(input.email);
  if (input.phone && !key) return res.status(400).json({ error: "Enter a full phone number" });
  if (input.email && !email) return res.status(400).json({ error: "Enter a valid email address" });
  if (!key && !email) return res.status(400).json({ error: "Add the client's phone or email" });
  const nameNormalized = normalizeName(input.name);

  // A partner may not register themself as a client.
  const identity = await loadPartnerIdentity(db, partnerId);
  if (identity && ((key && identity.phones.has(key)) || (email && identity.emails.has(email)))) {
    return res.status(400).json({ error: "You cannot add yourself as a client" });
  }

  const total = await db.salesClientAccount.count({ where: { salesPartnerId: partnerId } });
  if (total >= CLIENT_BOOK_LIMIT) return res.status(409).json({ error: "Your client book is full. Archive clients you no longer serve." });

  const own = await db.salesClientAccount.count({
    where: { salesPartnerId: partnerId, OR: [...(key ? [{ phoneKey: key }] : []), ...(email ? [{ emailNormalized: email }] : [])] },
  });
  if (own) return res.status(409).json({ error: "This client is already in your client book" });

  const conflict = await findProtectedConflict(db, { salesPartnerId: partnerId, phoneKey: key, emailNormalized: email, nameNormalized }, now);
  // Never say who: the other partner's client data must not leak.
  if (conflict.hard) return res.status(409).json({ error: "This client is already served by another NoLSAF partner. Contact NoLSAF support if you think this is wrong." });

  const client = await db.salesClientAccount.create({
    data: {
      reference: newClientReference(),
      salesPartnerId: partnerId,
      type: input.type,
      name: clean(input.name, 200)!,
      nameNormalized,
      contactName: clean(input.contactName, 160),
      phone: clean(input.phone, 40),
      phoneKey: key,
      email,
      emailNormalized: email,
      region: clean(input.region, 120),
      notes: clean(input.notes, 2000),
      duplicateReviewStatus: conflict.soft ? "POSSIBLE_DUPLICATE" : "CLEAR",
      protectionExpiresAt: protectionUntil(now),
    },
  });
  await audit(req, "SALES_AGENCY_CLIENT_CREATE", "SALES_PARTNER", null, { reference: client.reference, type: client.type, possibleDuplicate: conflict.soft }, partnerId);
  return res.status(201).json({
    client: serializeClient(client, now),
    ...(conflict.soft ? { warning: "A client with a similar name may already exist. NoLSAF will review it." } : {}),
  });
}) as RequestHandler);

router.get("/agency/clients/:ref", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const client = await ownClient(req.agency.salesPartnerId, req.params.ref);
  if (!client) return res.status(404).json(NOT_FOUND);
  const [activities, groups] = await Promise.all([
    db.salesClientActivity.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.salesAgencyGroupRequest.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return res.json({
    client: serializeClient(client),
    activities: activities.map((a: any) => ({ type: a.type, description: a.description, createdAt: a.createdAt })),
    groups: groups.map((g: any) => ({ reference: g.reference, status: g.status, createdAt: g.createdAt, destination: (g.payload as any)?.toRegion ?? null, headcount: (g.payload as any)?.headcount ?? null })),
  });
}) as RequestHandler);

const clientPatchSchema = z.object({
  contactName: optText(160),
  phone: optText(40),
  email: optText(190),
  region: optText(120),
  notes: optText(2000),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
}).strict();

router.patch("/agency/clients/:ref", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const partnerId = req.agency.salesPartnerId;
  const client = await ownClient(partnerId, req.params.ref);
  if (!client) return res.status(404).json(NOT_FOUND);
  const parsed = clientPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the client details" });
  const input = parsed.data;
  const data: any = {};
  if (input.contactName !== undefined) data.contactName = clean(input.contactName, 160);
  if (input.region !== undefined) data.region = clean(input.region, 120);
  if (input.notes !== undefined) data.notes = clean(input.notes, 2000);
  if (input.status) data.status = input.status;
  if (input.phone !== undefined || input.email !== undefined) {
    const key = input.phone !== undefined ? phoneKey(input.phone) : client.phoneKey;
    const email = input.email !== undefined ? normalizeEmail(input.email) : client.emailNormalized;
    if (input.phone && !key) return res.status(400).json({ error: "Enter a full phone number" });
    if (!key && !email) return res.status(400).json({ error: "Keep the client's phone or email" });
    const conflict = await findProtectedConflict(db, { salesPartnerId: partnerId, phoneKey: key, emailNormalized: email, nameNormalized: client.nameNormalized });
    if (conflict.hard) return res.status(409).json({ error: "This contact is already served by another NoLSAF partner. Contact NoLSAF support if you think this is wrong." });
    data.phone = input.phone !== undefined ? clean(input.phone, 40) : client.phone;
    data.phoneKey = key;
    data.email = email;
    data.emailNormalized = email;
  }
  const updated = await db.salesClientAccount.update({ where: { id: client.id }, data });
  await audit(req, "SALES_AGENCY_CLIENT_UPDATE", "SALES_PARTNER", null, { reference: client.reference, fields: Object.keys(data) }, partnerId);
  return res.json({ client: serializeClient(updated) });
}) as RequestHandler);

const activitySchema = z.object({ type: z.enum(CLIENT_ACTIVITY_TYPES), description: text(2000).min(2) }).strict();

router.post("/agency/clients/:ref/activities", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const client = await ownClient(req.agency.salesPartnerId, req.params.ref);
  if (!client) return res.status(404).json(NOT_FOUND);
  const parsed = activitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Describe what happened" });
  const now = new Date();
  await db.$transaction([
    db.salesClientActivity.create({ data: { clientId: client.id, createdById: Number(req.user.id), type: parsed.data.type, description: sanitizeText(parsed.data.description).slice(0, 2000) } }),
    // Real contact keeps the claim alive; an archived client does not renew.
    ...(client.status === "ACTIVE" ? [db.salesClientAccount.update({ where: { id: client.id }, data: { protectionExpiresAt: protectionUntil(now) } })] : []),
  ]);
  return res.status(201).json({ ok: true });
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Group stays
// ---------------------------------------------------------------------------

async function ownRequest(partnerId: number, reference: unknown) {
  if (!isGroupRef(reference)) return null;
  return db.salesAgencyGroupRequest.findFirst({ where: { reference: String(reference), salesPartnerId: partnerId } });
}

function confirmUrl(token: string) {
  return `${webOrigin()}/account/group-stays/confirm?t=${encodeURIComponent(token)}`;
}

async function smsClient(phone: string, agentCode: string, token: string) {
  const body =
    `NoLSAF: sales partner ${agentCode} prepared a group stay request for you. ` +
    `Confirm it here: ${confirmUrl(token)} ` +
    `You only ever pay NoLSAF directly. Link valid ${GROUP_REQUEST_LINK_HOURS} hours.`;
  return sendSms(phone, body, { bypassEligibilityCheck: true }).catch(() => null);
}

function summarizePayload(p: any) {
  return {
    groupType: p?.groupType ?? null,
    destination: [p?.toDistrict, p?.toRegion].filter(Boolean).join(", ") || null,
    accommodationType: p?.accommodationType ?? null,
    headcount: p?.headcount ?? null,
    roomsNeeded: p?.roomsNeeded ?? null,
    checkIn: p?.checkin ?? null,
    checkOut: p?.checkout ?? null,
    rosterCount: Array.isArray(p?.roster) ? p.roster.length : 0,
  };
}

router.get("/agency/groups", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const rows = await db.salesAgencyGroupRequest.findMany({
    where: { salesPartnerId: req.agency.salesPartnerId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { client: { select: { reference: true, name: true } } },
  });
  const bookingIds = rows.map((r: any) => r.groupBookingId).filter((v: any) => Number.isInteger(v));
  const bookings = bookingIds.length
    ? await db.groupBooking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, status: true, depositPaid: true, checkedInAt: true, _count: { select: { claims: true } } } })
    : [];
  const byId = new Map<number, any>(bookings.map((b: any) => [b.id, b]));
  return res.json({
    items: rows.map((r: any) => {
      const b = r.groupBookingId ? byId.get(r.groupBookingId) : null;
      return {
        reference: r.reference,
        status: r.status,
        client: r.client ? { reference: r.client.reference, name: r.client.name } : { reference: null, name: r.clientName },
        ...summarizePayload(r.payload),
        createdAt: r.createdAt,
        linkExpiresAt: r.status === "AWAITING_CLIENT" ? r.tokenExpiresAt : null,
        shortlistStatus: r.shortlistStatus,
        booking: b ? { status: b.status, paid: b.depositPaid, checkedIn: !!b.checkedInAt, bids: b._count?.claims ?? 0 } : null,
      };
    }),
  });
}) as RequestHandler);

const groupCreateSchema = z.object({
  clientRef: z.string().optional().nullable(),
  clientName: text(160).min(2).optional(),
  clientPhone: text(40).optional(),
  biddingDays: z.number().int().min(GROUP_BIDDING_DAYS_MIN).max(GROUP_BIDDING_DAYS_MAX).optional(),
  request: z.unknown(),
}).strict();

router.post("/agency/groups", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const parsed = groupCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the request details" });
  const payload = parseGroupPayload(parsed.data.request);
  if (!payload.success) return res.status(400).json({ error: "Check the group details", details: payload.error.issues });
  const partnerId = req.agency.salesPartnerId;

  let client: any = null;
  if (parsed.data.clientRef) {
    client = await ownClient(partnerId, parsed.data.clientRef);
    if (!client || client.status !== "ACTIVE") return res.status(400).json({ error: "Choose one of your active clients" });
  }
  const name = client?.contactName || client?.name || parsed.data.clientName;
  const phone = parsed.data.clientPhone || client?.phone;
  const key = phoneKey(phone);
  if (!name || !phone || !key) return res.status(400).json({ error: "The client's name and phone are needed to confirm the request" });

  const identity = await loadPartnerIdentity(db, partnerId);
  if (identity?.phones.has(key)) return res.status(400).json({ error: "The client must confirm from their own phone, not yours" });

  const open = await db.salesAgencyGroupRequest.count({ where: { salesPartnerId: partnerId, status: "AWAITING_CLIENT" } });
  if (open >= MAX_OPEN_REQUESTS) return res.status(409).json({ error: "You have too many requests waiting for clients. Follow those up first." });

  const now = new Date();
  const { token, tokenHash } = newGroupRequestToken();
  const request = await db.salesAgencyGroupRequest.create({
    data: {
      reference: newGroupRequestReference(),
      salesPartnerId: partnerId,
      clientId: client?.id ?? null,
      clientName: sanitizeText(String(name)).slice(0, 160),
      clientPhone: sanitizeText(String(phone)).slice(0, 40),
      clientPhoneKey: key,
      payload: payload.data as any,
      tokenHash,
      tokenExpiresAt: new Date(now.getTime() + GROUP_REQUEST_LINK_HOURS * HOUR_MS),
      biddingDays: parsed.data.biddingDays ?? 3,
    },
  });
  if (client) {
    await db.salesClientActivity.create({ data: { clientId: client.id, createdById: Number(req.user.id), type: "GROUP_REQUEST", description: `Group stay request ${request.reference} sent for confirmation.` } });
  }
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { agentCode: true } });
  const sms = await smsClient(request.clientPhone, partner?.agentCode || "NoLSAF", token);
  await audit(req, "SALES_AGENCY_GROUP_CREATE", "SALES_PARTNER", null, { reference: request.reference, smsSent: !!sms }, partnerId);
  return res.status(201).json({ reference: request.reference, status: request.status, linkExpiresAt: request.tokenExpiresAt, smsSent: !!sms });
}) as RequestHandler);

router.get("/agency/groups/:ref", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  if (!r) return res.status(404).json(NOT_FOUND);
  let booking: any = null;
  let bids: any[] = [];
  if (r.groupBookingId) {
    const gb = await db.groupBooking.findUnique({
      where: { id: r.groupBookingId },
      select: {
        id: true, status: true, paymentMode: true, isOpenForClaims: true, totalAmount: true, depositPaid: true, depositPaidAt: true,
        checkedInAt: true, currency: true, roomsNeeded: true, checkIn: true, checkOut: true, recommendedPropertyIds: true,
        confirmedProperty: { select: { title: true, publicKey: true } },
      },
    });
    if (gb) {
      booking = {
        status: gb.status,
        openForBids: gb.isOpenForClaims,
        paid: gb.depositPaid,
        paidAt: gb.depositPaidAt,
        checkedIn: !!gb.checkedInAt,
        total: gb.totalAmount != null ? Number(gb.totalAmount) : null,
        currency: gb.currency,
        chosenProperty: gb.confirmedProperty ? { title: gb.confirmedProperty.title, key: gb.confirmedProperty.publicKey } : null,
      };
      const claims = await db.groupBookingClaim.findMany({
        where: { groupBookingId: gb.id, status: { not: "WITHDRAWN" } },
        orderBy: { totalAmount: "asc" },
        take: 50,
        select: {
          status: true, totalAmount: true, offeredPricePerNight: true, discountPercent: true, specialOffers: true, currency: true, createdAt: true,
          property: { select: { title: true, publicKey: true, regionName: true, district: true, type: true, services: true } },
        },
      });
      const shortlisted = new Set<string>();
      const ids = Array.isArray(gb.recommendedPropertyIds) ? (gb.recommendedPropertyIds as any[]).map(Number) : [];
      if (ids.length) {
        const props = await db.property.findMany({ where: { id: { in: ids } }, select: { publicKey: true } });
        props.forEach((p: any) => shortlisted.add(p.publicKey));
      }
      bids = await Promise.all(claims.map(async (c: any) => {
        const pct = await getEffectiveCommissionPercent(c.property?.services);
        return {
          property: { key: c.property.publicKey, title: c.property.title, type: c.property.type, area: [c.property.district, c.property.regionName].filter(Boolean).join(", ") },
          clientTotal: customerTotalFor(Number(c.totalAmount), pct),
          currency: c.currency,
          specialOffers: c.specialOffers,
          status: c.status,
          shortlisted: shortlisted.has(c.property.publicKey),
          receivedAt: c.createdAt,
        };
      }));
    }
  }
  const leadIds: number[] = Array.isArray(r.pendingLeadIds) ? (r.pendingLeadIds as any[]).map(Number) : [];
  const leads = leadIds.length
    ? await db.salesLead.findMany({ where: { id: { in: leadIds }, salesPartnerId: req.agency.salesPartnerId }, select: { id: true, propertyName: true, status: true } })
    : [];
  const commission = r.groupBookingId
    ? await db.salesCommission.findUnique({ where: { sourceKey: `AGENCY_GROUP:${r.groupBookingId}` }, select: { status: true, commissionAmount: true, currency: true, reversalReason: true } })
    : null;
  return res.json({
    request: {
      reference: r.reference,
      status: r.status,
      clientName: r.clientName,
      clientPhone: maskClientPhone(r.clientPhone),
      ...summarizePayload(r.payload),
      linkExpiresAt: r.status === "AWAITING_CLIENT" ? r.tokenExpiresAt : null,
      confirmedAt: r.confirmedAt,
      biddingDays: r.biddingDays,
      shortlistStatus: r.shortlistStatus,
    },
    booking,
    bids,
    unlistedProperties: leads.map((l: any) => ({ ref: leadRef(l.id), name: l.propertyName, status: l.status })),
    commission: commission ? { status: commission.status, amount: Number(commission.commissionAmount), currency: commission.currency, reason: commission.reversalReason } : null,
  });
}) as RequestHandler);

router.post("/agency/groups/:ref/resend", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  if (!r) return res.status(404).json(NOT_FOUND);
  if (r.status !== "AWAITING_CLIENT") return res.status(409).json({ error: "The client already answered this request" });
  const { token, tokenHash } = newGroupRequestToken();
  const now = new Date();
  const moved = await db.salesAgencyGroupRequest.updateMany({
    where: { id: r.id, status: "AWAITING_CLIENT" },
    data: { tokenHash, tokenExpiresAt: new Date(now.getTime() + GROUP_REQUEST_LINK_HOURS * HOUR_MS), sentAt: now },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "The request was changed by another action" });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: r.salesPartnerId }, select: { agentCode: true } });
  const sms = await smsClient(r.clientPhone, partner?.agentCode || "NoLSAF", token);
  await audit(req, "SALES_AGENCY_GROUP_RESEND", "SALES_PARTNER", null, { reference: r.reference }, r.salesPartnerId);
  return res.json({ ok: true, smsSent: !!sms });
}) as RequestHandler);

router.post("/agency/groups/:ref/cancel", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  if (!r) return res.status(404).json(NOT_FOUND);
  const parsed = z.object({ reason: text(300).min(3) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason" });
  const moved = await db.salesAgencyGroupRequest.updateMany({
    where: { id: r.id, status: "AWAITING_CLIENT" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: sanitizeText(parsed.data.reason).slice(0, 300) },
  });
  // Once the client confirmed, the group stay is theirs; cancelling goes through NoLSAF support.
  if (moved.count !== 1) return res.status(409).json({ error: "Only a request the client has not confirmed can be cancelled here" });
  await audit(req, "SALES_AGENCY_GROUP_CANCEL", "SALES_PARTNER", null, { reference: r.reference }, r.salesPartnerId);
  return res.json({ ok: true });
}) as RequestHandler);

/** Cancelled or expired: nothing more can be done on the group from the desk. */
export function isClosedGroup(gb: { status?: string | null } | null | undefined): boolean {
  return ["CANCELED", "CANCELLED", "EXPIRED"].includes(String(gb?.status || "").toUpperCase());
}

async function liveGroup(r: any) {
  if (!r || r.status !== "CONFIRMED" || !r.groupBookingId) return null;
  return db.groupBooking.findUnique({
    where: { id: r.groupBookingId },
    select: { id: true, userId: true, status: true, isOpenForClaims: true, confirmedPropertyId: true, roomsNeeded: true, toRegion: true, toDistrict: true, depositPaid: true },
  });
}

const inviteSchema = z.object({ propertyUrls: z.array(z.string().trim().max(400)).min(1).max(GROUP_INVITE_MAX) }).strict();

router.post("/agency/groups/:ref/invite", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  const gb = await liveGroup(r);
  if (!r || !gb) return res.status(404).json(NOT_FOUND);
  if (isClosedGroup(gb) || !gb.isOpenForClaims || gb.confirmedPropertyId) return res.status(409).json({ error: "Bidding on this group is closed" });
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Paste 1 to ${GROUP_INVITE_MAX} NoLSAF property links` });
  const previous = await db.groupBookingAudit.count({ where: { groupBookingId: gb.id, action: "AGENCY_INVITED_OWNERS" } });
  if (previous >= 5) return res.status(409).json({ error: "You have already invited owners several times for this group. Contact NoLSAF if you need more." });

  const keys = [...new Set(parsed.data.propertyUrls.map(propertyKeyFromInput).filter(Boolean) as string[])];
  const properties = keys.length
    ? await db.property.findMany({ where: { publicKey: { in: keys }, status: "APPROVED" }, select: { id: true, ownerId: true, title: true } })
    : [];
  const identity = await loadPartnerIdentity(db, r.salesPartnerId);
  const invited: string[] = [];
  const skipped: string[] = [];
  for (const p of properties) {
    // Inviting your own property would let you set the price you then earn on.
    if (identity && (await partnerOwnsPropertyReason(db, identity, p.id))) {
      skipped.push(p.title);
      continue;
    }
    const already = await db.groupBookingClaim.count({ where: { groupBookingId: gb.id, ownerId: p.ownerId } });
    if (already) {
      skipped.push(p.title);
      continue;
    }
    await notifyUser(p.ownerId, "group_stay_update", {
      title: "You are invited to bid on a group stay",
      body: `A NoLSAF sales partner invited ${p.title} to send an offer for group stay #${gb.id}${[gb.toDistrict, gb.toRegion].filter(Boolean).length ? ` to ${[gb.toDistrict, gb.toRegion].filter(Boolean).join(", ")}` : ""}. Open Group stays in your owner dashboard to bid. All prices go through NoLSAF.`,
      groupBookingId: gb.id,
    }).catch(() => undefined);
    invited.push(p.title);
  }
  await db.groupBookingAudit.create({
    data: { groupBookingId: gb.id, adminId: Number(req.user.id), action: "AGENCY_INVITED_OWNERS", description: `Sales partner invited ${invited.length} owner(s) to bid.`, metadata: { propertyIds: properties.map((p: any) => p.id), invited: invited.length } },
  });
  return res.json({ invited, skipped, notFound: keys.length - properties.length });
}) as RequestHandler);

const shortlistSchema = z.object({ propertyKeys: z.array(z.string().regex(/^[A-Za-z0-9]{8,40}$/)).min(1).max(GROUP_SHORTLIST_MAX) }).strict();

router.post("/agency/groups/:ref/shortlist", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  const gb = await liveGroup(r);
  if (!r || !gb) return res.status(404).json(NOT_FOUND);
  if (isClosedGroup(gb)) return res.status(409).json({ error: "This group stay is closed" });
  if (gb.confirmedPropertyId || gb.depositPaid) return res.status(409).json({ error: "The client has already chosen" });
  const parsed = shortlistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Choose 1 to ${GROUP_SHORTLIST_MAX} bids` });
  const keys = [...new Set(parsed.data.propertyKeys)];
  const claims = await db.groupBookingClaim.findMany({
    where: { groupBookingId: gb.id, status: "PENDING", property: { publicKey: { in: keys } } },
    select: { propertyId: true, totalAmount: true, property: { select: { publicKey: true, services: true } } },
  });
  if (claims.length !== keys.length) return res.status(400).json({ error: "Only open bids on this group can be shortlisted" });
  const identity = await loadPartnerIdentity(db, r.salesPartnerId);
  for (const c of claims) {
    if (identity && (await partnerOwnsPropertyReason(db, identity, c.propertyId))) {
      return res.status(400).json({ error: "You cannot shortlist a property you own or are paid through" });
    }
  }
  const totals = await Promise.all(claims.map(async (c: any) => customerTotalFor(Number(c.totalAmount), await getEffectiveCommissionPercent(c.property.services))));
  // Keep the partner's order.
  const ordered = keys.map((k) => claims.find((c: any) => c.property.publicKey === k)!.propertyId);
  const review = shortlistNeedsReview({ roomsNeeded: gb.roomsNeeded, customerTotals: totals });
  const now = new Date();
  await db.$transaction(async (tx: any) => {
    await tx.salesAgencyGroupRequest.update({
      where: { id: r.id },
      data: { shortlistPropertyIds: ordered, shortlistStatus: review ? "PENDING_REVIEW" : "PUBLISHED", shortlistReviewedAt: null, shortlistReviewedById: null },
    });
    // The client only sees offers once published. Under review, nothing changes for them yet.
    await tx.groupBooking.update({ where: { id: gb.id }, data: { recommendedPropertyIds: review ? [] : ordered } });
    await tx.groupBookingAudit.create({
      data: { groupBookingId: gb.id, adminId: Number(req.user.id), action: review ? "AGENCY_SHORTLIST_FOR_REVIEW" : "AGENCY_SHORTLIST_PUBLISHED", description: `Sales partner shortlisted ${ordered.length} offer(s).`, metadata: { propertyIds: ordered, customerTotals: totals }, createdAt: now },
    });
  });
  if (review) {
    void notifyAdmins("sales_agency_shortlist_review", { reference: r.reference, rooms: gb.roomsNeeded, href: "/admin/sales/agency" }).catch(() => undefined);
  } else {
    await notifyUser(gb.userId, "group_stay_update", {
      title: "Offers ready for your group stay",
      body: `Your NoLSAF sales partner shared ${ordered.length} offer${ordered.length === 1 ? "" : "s"} for group stay #${gb.id}. Open it to compare and choose. You pay NoLSAF directly.`,
      groupBookingId: gb.id,
    }).catch(() => undefined);
  }
  await audit(req, "SALES_AGENCY_GROUP_SHORTLIST", "SALES_PARTNER", null, { reference: r.reference, count: ordered.length, review }, r.salesPartnerId);
  return res.json({ ok: true, shortlistStatus: review ? "PENDING_REVIEW" : "PUBLISHED" });
}) as RequestHandler);

router.post("/agency/groups/:ref/message", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  const gb = await liveGroup(r);
  if (!r || !gb) return res.status(404).json(NOT_FOUND);
  const parsed = z.object({ body: text(2000).min(2) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Write a message" });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: r.salesPartnerId }, select: { agentCode: true } });
  await db.groupBookingMessage.create({
    data: {
      groupBookingId: gb.id,
      senderId: Number(req.user.id),
      senderRole: "SALES_PARTNER",
      senderName: `NoLSAF sales partner ${partner?.agentCode || ""}`.trim(),
      messageType: "Sales partner",
      body: sanitizeText(parsed.data.body).slice(0, 2000),
      isInternal: false,
    },
  });
  await notifyUser(gb.userId, "group_stay_update", { title: "New message about your group stay", body: "Your NoLSAF sales partner sent you a message.", groupBookingId: gb.id }).catch(() => undefined);
  return res.status(201).json({ ok: true });
}) as RequestHandler);

router.post("/agency/groups/:ref/leads", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const r = await ownRequest(req.agency.salesPartnerId, req.params.ref);
  const gb = await liveGroup(r);
  if (!r || !gb) return res.status(404).json(NOT_FOUND);
  if (isClosedGroup(gb) || gb.confirmedPropertyId) return res.status(409).json({ error: "This group stay no longer takes new properties" });
  const parsed = z.object({ leadRef: z.string().max(64) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose one of your property leads" });
  const leadId = await resolvePartnerLead(db, parsed.data.leadRef, r.salesPartnerId);
  if (!leadId) return res.status(404).json({ error: "Lead not found" });
  const existing: number[] = Array.isArray(r.pendingLeadIds) ? (r.pendingLeadIds as any[]).map(Number) : [];
  if (existing.includes(leadId)) return res.json({ ok: true });
  if (existing.length >= 5) return res.status(409).json({ error: "Up to five unlisted properties per group" });
  await db.salesAgencyGroupRequest.update({ where: { id: r.id }, data: { pendingLeadIds: [...existing, leadId] } });
  const lead = await db.salesLead.findUnique({ where: { id: leadId }, select: { propertyName: true } });
  void notifyAdmins("sales_agency_group_lead_fast_track", { reference: r.reference, propertyName: lead?.propertyName || "A property", href: "/admin/sales" }).catch(() => undefined);
  await audit(req, "SALES_AGENCY_GROUP_LEAD", "SALES_PARTNER", null, { reference: r.reference, leadRef: leadRef(leadId) }, r.salesPartnerId);
  return res.json({ ok: true });
}) as RequestHandler);

export default router;
