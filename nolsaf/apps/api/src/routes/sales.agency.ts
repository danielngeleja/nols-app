/**
 * Sales Agency Desk, partner side.
 *
 * GET  /api/sales/agency/status                  capability and, while pending, the addendum
 * POST /api/sales/agency/addendum/accept         accept the addendum (own session only)
 * GET  /api/sales/agency/links                   own booking links
 * POST /api/sales/agency/links                   create a booking link
 * POST /api/sales/agency/links/:reference/revoke close one of own links
 * GET  /api/sales/agency/bookings                bookings credited to own links
 *
 * Every route answers 404 unless the caller is a sales partner who currently
 * holds the capability (see agencyGateFailure). No admin bypass: an admin with
 * no partner profile of their own gets 404 here and uses the admin routes.
 * Partner identity always comes from the session, never from the request.
 */
import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { partnerIdFor, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { buildPropertySlug } from "../lib/publicPropertyDto.js";
import {
  AGENCY_CAPABILITY,
  AGENCY_LINK_DEFAULT_DAYS,
  AGENCY_LINK_HARD_CAP,
  AGENCY_LINK_MAX_DAYS,
  AGENCY_TERMS_VERSION,
  agencyAddendumText,
  agencyGateFailure,
  agencyLinkToken,
  agencyLinkUrl,
  agencyTermsHash,
  hashAgencyToken,
  loadAgencyGateInput,
  maskClientPhone,
  newAgencyLinkReference,
  newAgencyLinkSalt,
  propertyKeyFromInput,
} from "../lib/salesAgency.js";
import { approvedOperatorProfile, bookablePackages, tourLinkUrl } from "../lib/salesAgencyTours.js";

const router = Router();
const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"));

function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

const NOT_FOUND = { error: "Not found" };

/** 404 unless the session's partner holds the Agency Desk right now. */
function requireAgencyDesk(opts: { allowPending?: boolean } = {}): RequestHandler {
  return (async (req: SalesAuthedRequest & { agency?: any }, res: Response, next: NextFunction) => {
    const partnerId = partnerIdFor(req);
    if (!partnerId) return res.status(404).json(NOT_FOUND);
    const gate = await loadAgencyGateInput(db, partnerId);
    if (agencyGateFailure(gate, opts)) return res.status(404).json(NOT_FOUND);
    req.agency = gate.capabilityRow;
    return next();
  }) as RequestHandler;
}

function liveLinkWhere(partnerId: number, now: Date) {
  return { salesPartnerId: partnerId, revokedAt: null, expiresAt: { gt: now } };
}

router.get("/agency/status", limitSalesLeadRead, requireAgencyDesk({ allowPending: true }), asyncHandler(async (req: any, res: Response) => {
  const cap = req.agency;
  const stayRate = Number(cap.stayRate);
  const pending = cap.status === "PENDING_ACCEPTANCE";
  const liveLinks = await db.salesAgencyLink.count({ where: liveLinkWhere(cap.salesPartnerId, new Date()) });
  return res.json({
    status: cap.status,
    stayRate,
    termsVersion: cap.termsVersion,
    acceptedAt: cap.acceptedAt,
    maxActiveLinks: Math.min(cap.maxActiveLinks, AGENCY_LINK_HARD_CAP),
    liveLinks,
    ...(pending ? { addendum: agencyAddendumText(stayRate), termsHash: agencyTermsHash(stayRate) } : {}),
  });
}) as RequestHandler);

const acceptSchema = z.object({
  acceptedName: z.string().trim().min(3).max(160),
  termsHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

router.post("/agency/addendum/accept", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk({ allowPending: true }), asyncHandler(async (req: any, res: Response) => {
  const cap = req.agency;
  if (cap.status !== "PENDING_ACCEPTANCE") return res.status(409).json({ error: "There is nothing to accept" });
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Type your full name to accept" });
  const expected = agencyTermsHash(Number(cap.stayRate));
  // The partner accepts the exact text they were shown. A rate change in the
  // meantime changes the hash, so stale acceptance is refused.
  if (parsed.data.termsHash !== expected || cap.termsVersion !== AGENCY_TERMS_VERSION) {
    return res.status(409).json({ error: "The addendum changed. Reload and read it again." });
  }
  const now = new Date();
  const moved = await db.salesPartnerCapability.updateMany({
    where: { id: cap.id, status: "PENDING_ACCEPTANCE", stayRate: cap.stayRate },
    data: {
      status: "ACTIVE",
      acceptedAt: now,
      acceptedTermsHash: expected,
      acceptedName: sanitizeText(parsed.data.acceptedName).slice(0, 160),
      acceptedIpAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 64),
      acceptedUserAgent: String(req.get("user-agent") || "").slice(0, 255),
    },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "The addendum changed. Reload and read it again." });
  await audit(req, "SALES_AGENCY_ACCEPT", "SALES_PARTNER", { status: "PENDING_ACCEPTANCE" }, {
    status: "ACTIVE",
    termsVersion: AGENCY_TERMS_VERSION,
    termsHash: expected,
    stayRate: Number(cap.stayRate),
  }, cap.salesPartnerId);
  return res.json({ ok: true, status: "ACTIVE", acceptedAt: now });
}) as RequestHandler);

export function serializeLink(link: any, property: any | null, now: Date, tour?: { title: string; operatorPublicKey: string; packageId: string; travelers?: number | null } | null) {
  const live = !link.revokedAt && new Date(link.expiresAt).getTime() > now.getTime() && (link.maxUses == null || link.useCount < link.maxUses);
  const slug = property ? buildPropertySlug(property.title, property.nrmsBookingKey) : null;
  let url: string | null = null;
  if (live) {
    const token = agencyLinkToken(link);
    // After a signing-secret rotation the recomputed token no longer matches; the partner makes a new link.
    if (hashAgencyToken(token) === link.tokenHash) {
      url = tour ? tourLinkUrl(webOrigin(), token, tour.operatorPublicKey, tour.packageId, tour.travelers) : agencyLinkUrl(webOrigin(), token, slug);
    }
  }
  return {
    reference: link.reference,
    label: link.label,
    kind: link.operatorAgentId != null ? "TOUR" : "STAY",
    property: property ? { title: property.title, slug } : null,
    tour: tour ? { title: tour.title } : null,
    clientName: link.clientName,
    clientPhone: maskClientPhone(link.clientPhone),
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    useCount: link.useCount,
    lastUsedAt: link.lastUsedAt,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt,
    status: link.revokedAt ? "REVOKED" : new Date(link.expiresAt).getTime() <= now.getTime() ? "EXPIRED" : live ? "LIVE" : "USED_UP",
    url,
  };
}

/** Tour title and booking target for each tour link, read from the operator's approved packages. */
export async function toursForLinks(dbc: any, links: any[]) {
  const out = new Map<number, { title: string; operatorPublicKey: string; packageId: string; travelers?: number | null }>();
  const operatorIds = [...new Set(links.map((l) => l.operatorAgentId).filter((v: any) => Number.isInteger(v)))];
  if (!operatorIds.length) return out;
  const agents = await dbc.agent.findMany({ where: { id: { in: operatorIds } }, select: { id: true, publicKey: true, operatorProfile: true } });
  const byId = new Map<number, any>(agents.map((a: any) => [a.id, a]));
  for (const l of links) {
    if (l.operatorAgentId == null) continue;
    const agent = byId.get(l.operatorAgentId);
    if (!agent) continue;
    const pkg = bookablePackages(approvedOperatorProfile(agent.operatorProfile)).find((p) => p.id === String(l.tourPackageId));
    out.set(l.id, { title: String(pkg?.pkg?.name || pkg?.pkg?.title || l.label), operatorPublicKey: agent.publicKey, packageId: String(l.tourPackageId) });
  }
  return out;
}

async function propertiesById(ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (!unique.length) return new Map<number, any>();
  const rows = await db.property.findMany({ where: { id: { in: unique } }, select: { id: true, title: true, nrmsBookingKey: true } });
  return new Map<number, any>(rows.map((p: any) => [p.id, p]));
}

router.get("/agency/links", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const partnerId = req.agency.salesPartnerId;
  const links = await db.salesAgencyLink.findMany({ where: { salesPartnerId: partnerId }, orderBy: { createdAt: "desc" }, take: 200 });
  const props = await propertiesById(links.map((l: any) => l.propertyId));
  const tours = await toursForLinks(db, links);
  const now = new Date();
  return res.json({ items: links.map((l: any) => serializeLink(l, l.propertyId ? props.get(l.propertyId) ?? null : null, now, tours.get(l.id) ?? null)) });
}) as RequestHandler);

const createLinkSchema = z.object({
  label: z.string().trim().min(2).max(120),
  propertyUrl: z.string().trim().max(400).optional().nullable(),
  clientName: z.string().trim().max(160).optional().nullable(),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(AGENCY_LINK_MAX_DAYS).optional(),
  maxUses: z.number().int().min(1).max(500).optional().nullable(),
}).strict();

router.post("/agency/links", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const cap = req.agency;
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the link details", details: parsed.error.issues });
  const input = parsed.data;
  const now = new Date();

  let property: any = null;
  if (input.propertyUrl) {
    const key = propertyKeyFromInput(input.propertyUrl);
    if (!key) return res.status(400).json({ error: "Paste the NoLSAF property page link" });
    property = await db.property.findFirst({ where: { nrmsBookingKey: key, status: "APPROVED" }, select: { id: true, title: true, nrmsBookingKey: true } });
    if (!property) return res.status(400).json({ error: "That property is not available for booking" });
  }

  const limit = Math.min(Number(cap.maxActiveLinks) || 0, AGENCY_LINK_HARD_CAP);
  const salt = newAgencyLinkSalt();
  const created = await db.$transaction(async (tx: any) => {
    const live = await tx.salesAgencyLink.count({ where: liveLinkWhere(cap.salesPartnerId, now) });
    if (live >= limit) return null;
    const row = await tx.salesAgencyLink.create({
      data: {
        reference: newAgencyLinkReference(),
        salesPartnerId: cap.salesPartnerId,
        salt,
        // Placeholder until the id exists; replaced in the same transaction.
        tokenHash: hashAgencyToken(`pending:${salt}`),
        label: sanitizeText(input.label).slice(0, 120),
        propertyId: property?.id ?? null,
        clientName: input.clientName ? sanitizeText(input.clientName).slice(0, 160) : null,
        clientPhone: input.clientPhone ? sanitizeText(input.clientPhone).slice(0, 40) : null,
        expiresAt: new Date(now.getTime() + (input.expiresInDays ?? AGENCY_LINK_DEFAULT_DAYS) * DAY_MS),
        maxUses: input.maxUses ?? null,
      },
    });
    return tx.salesAgencyLink.update({ where: { id: row.id }, data: { tokenHash: hashAgencyToken(agencyLinkToken(row)) } });
  });
  if (!created) return res.status(409).json({ error: `You already have ${limit} live links. Close one first.` });
  await audit(req, "SALES_AGENCY_LINK_CREATE", "SALES_PARTNER", null, {
    reference: created.reference,
    propertyId: created.propertyId,
    expiresAt: created.expiresAt,
    maxUses: created.maxUses,
  }, cap.salesPartnerId);
  return res.status(201).json({ link: serializeLink(created, property, now) });
}) as RequestHandler);

router.post("/agency/links/:reference/revoke", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const reference = String(req.params.reference || "");
  if (!/^al_[a-f0-9]{20}$/.test(reference)) return res.status(404).json(NOT_FOUND);
  const now = new Date();
  // Scoped to the session's partner: another partner's reference is simply not found.
  const moved = await db.salesAgencyLink.updateMany({
    where: { reference, salesPartnerId: req.agency.salesPartnerId, revokedAt: null },
    data: { revokedAt: now, revokeReason: "Closed by the partner" },
  });
  if (moved.count !== 1) return res.status(404).json(NOT_FOUND);
  await audit(req, "SALES_AGENCY_LINK_REVOKE", "SALES_PARTNER", null, { reference }, req.agency.salesPartnerId);
  return res.json({ ok: true });
}) as RequestHandler);

router.get("/agency/bookings", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const partnerId = req.agency.salesPartnerId;
  const rows = await db.bookingChannelAttribution.findMany({
    where: { salesPartnerId: partnerId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { link: { select: { reference: true, label: true } } },
  });
  const bookingIds = rows.map((r: any) => r.bookingId);
  const [bookings, commissions] = await Promise.all([
    bookingIds.length
      ? db.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, status: true, checkIn: true, checkOut: true, guestName: true, guestPhone: true, property: { select: { title: true } } },
        })
      : [],
    bookingIds.length
      ? db.salesCommission.findMany({
          where: { salesPartnerId: partnerId, type: "AGENCY_STAY", sourceBookingId: { in: bookingIds } },
          select: { sourceBookingId: true, status: true, commissionAmount: true, currency: true, reversalReason: true },
        })
      : [],
  ]);
  const bookingById = new Map<number, any>(bookings.map((b: any) => [b.id, b]));
  const commissionByBooking = new Map<number, any>(commissions.map((c: any) => [c.sourceBookingId, c]));
  return res.json({
    items: rows.map((r: any) => {
      const b = bookingById.get(r.bookingId);
      const c = commissionByBooking.get(r.bookingId);
      // First name only and a masked phone: enough to recognise the client, nothing to harvest.
      const firstName = String(b?.guestName || "").trim().split(/\s+/)[0] || null;
      return {
        creditedAt: r.createdAt,
        status: r.status,
        blockedReason: r.status === "BLOCKED" ? r.blockedReason : null,
        link: r.link ? { reference: r.link.reference, label: r.link.label } : null,
        booking: b
          ? {
              property: b.property?.title ?? null,
              checkIn: b.checkIn,
              checkOut: b.checkOut,
              status: b.status,
              guest: firstName,
              guestPhone: maskClientPhone(b.guestPhone),
            }
          : null,
        commission: c
          ? { status: c.status, amount: Number(c.commissionAmount), currency: c.currency, reason: c.status === "REVERSED" ? c.reversalReason : null }
          : null,
      };
    }),
  });
}) as RequestHandler);

export { requireAgencyDesk, AGENCY_CAPABILITY };
export default router;
