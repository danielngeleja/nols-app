/**
 * Agency Desk tour referrals, partner side.
 *
 * GET  /api/sales/agency/tours                 approved operator packages to recommend
 * POST /api/sales/agency/tour-links            a signed link to one package
 * GET  /api/sales/agency/tour-bookings         tours credited to the partner
 * POST /api/sales/agency/groups/:ref/tours     send a tour to a group stay client
 *
 * 404 unless the session's partner holds the Agency Desk. The partner never sets
 * a price: the link opens the operator's listed package in the normal checkout,
 * and the client pays NoLSAF. The operator is never told which partner it was.
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
import { notifyUser } from "../lib/notifications.js";
import { loadPartnerIdentity } from "../lib/salesSelfDealing.js";
import {
  AGENCY_LINK_DEFAULT_DAYS,
  AGENCY_LINK_HARD_CAP,
  AGENCY_LINK_MAX_DAYS,
  agencyLinkToken,
  hashAgencyToken,
  maskClientPhone,
  newAgencyLinkReference,
  newAgencyLinkSalt,
} from "../lib/salesAgency.js";
import { approvedOperatorProfile, bookablePackages, parseTourKey, partnerIsOperatorReason, tourKey, tourLinkUrl } from "../lib/salesAgencyTours.js";
import { requireAgencyDesk } from "./sales.agency.js";

const router = Router();
const db = prisma as any;
const NOT_FOUND = { error: "Not found" };
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

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function tourCommissionPercent(): Promise<number> {
  const s = await db.systemSetting.findUnique({ where: { id: 1 }, select: { agentCommissionPercent: true } }).catch(() => null);
  const pct = Number(s?.agentCommissionPercent ?? 15);
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 15;
}

/** Resolve a tour key to the operator and package, or null when it is not bookable. */
async function resolveTour(key: unknown) {
  const parsed = parseTourKey(key);
  if (!parsed) return null;
  const agent = await db.agent.findFirst({
    where: { publicKey: parsed.operatorPublicKey, status: "ACTIVE", operatorProfile: { not: null } },
    select: { id: true, publicKey: true, operatorProfile: true },
  });
  if (!agent) return null;
  const profile = approvedOperatorProfile(agent.operatorProfile);
  const found = bookablePackages(profile).find((p) => p.id === parsed.packageId);
  if (!found) return null;
  return { agent, profile, packageId: found.id, pkg: found.pkg };
}

router.get("/agency/tours", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
  const agents = await db.agent.findMany({
    where: { status: "ACTIVE", operatorProfile: { not: null } },
    select: { id: true, publicKey: true, operatorProfile: true },
    take: 300,
  });
  const identity = await loadPartnerIdentity(db, req.agency.salesPartnerId);
  const pct = await tourCommissionPercent();
  const items: any[] = [];
  for (const agent of agents) {
    const profile = approvedOperatorProfile(agent.operatorProfile);
    if (!profile) continue;
    // A partner never recommends their own operator business.
    if (identity && (await partnerIsOperatorReason(db, identity, agent.id))) continue;
    for (const { id, pkg } of bookablePackages(profile)) {
      const title = String(pkg?.name || pkg?.title || "Tour package");
      const operator = String(profile.companyName || "Tour operator");
      const destination = String(pkg?.destination || "");
      if (q && !`${title} ${operator} ${destination} ${pkg?.category || ""}`.toLowerCase().includes(q)) continue;
      const base = num(pkg?.pricePerPerson || pkg?.price);
      items.push({
        key: tourKey(agent.publicKey, id),
        title,
        operator,
        destination: destination || null,
        category: pkg?.category ? String(pkg.category) : null,
        // What the client pays per person: the operator's price plus NoLSAF's commission, as at checkout.
        clientPricePerPerson: Math.round(base * (1 + pct / 100) * 100) / 100,
        currency: String(pkg?.currency || "TZS").slice(0, 3).toUpperCase(),
        minPax: Math.max(1, num(pkg?.minPax) || 1),
        maxPax: Math.max(Math.max(1, num(pkg?.minPax) || 1), num(pkg?.maxPax) || 1),
        duration: pkg?.duration ? String(pkg.duration) : null,
      });
      if (items.length >= 150) break;
    }
    if (items.length >= 150) break;
  }
  return res.json({ items });
}) as RequestHandler);

const tourLinkSchema = z.object({
  tourKey: z.string().max(170),
  label: z.string().trim().min(2).max(120).optional(),
  clientName: z.string().trim().max(160).optional().nullable(),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  travelers: z.number().int().min(1).max(200).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(AGENCY_LINK_MAX_DAYS).optional(),
  maxUses: z.number().int().min(1).max(500).optional().nullable(),
}).strict();

/** Create a tour link inside the partner's live-link cap. Shared by the plain and the group flows. */
async function createTourLink(cap: any, input: z.infer<typeof tourLinkSchema>, tour: NonNullable<Awaited<ReturnType<typeof resolveTour>>>) {
  const now = new Date();
  const limit = Math.min(Number(cap.maxActiveLinks) || 0, AGENCY_LINK_HARD_CAP);
  const title = String(tour.pkg?.name || tour.pkg?.title || "Tour package");
  const minPax = Math.max(1, num(tour.pkg?.minPax) || 1);
  const maxPax = Math.max(minPax, num(tour.pkg?.maxPax) || minPax);
  const travelers = input.travelers ? Math.min(maxPax, Math.max(minPax, input.travelers)) : null;
  const salt = newAgencyLinkSalt();
  const created = await db.$transaction(async (tx: any) => {
    const live = await tx.salesAgencyLink.count({ where: { salesPartnerId: cap.salesPartnerId, revokedAt: null, expiresAt: { gt: now } } });
    if (live >= limit) return null;
    const row = await tx.salesAgencyLink.create({
      data: {
        reference: newAgencyLinkReference(),
        salesPartnerId: cap.salesPartnerId,
        salt,
        tokenHash: hashAgencyToken(`pending:${salt}`),
        label: sanitizeText(input.label || title).slice(0, 120),
        propertyId: null,
        operatorAgentId: tour.agent.id,
        tourPackageId: tour.packageId,
        clientName: input.clientName ? sanitizeText(input.clientName).slice(0, 160) : null,
        clientPhone: input.clientPhone ? sanitizeText(input.clientPhone).slice(0, 40) : null,
        expiresAt: new Date(now.getTime() + (input.expiresInDays ?? AGENCY_LINK_DEFAULT_DAYS) * DAY_MS),
        maxUses: input.maxUses ?? null,
      },
    });
    return tx.salesAgencyLink.update({ where: { id: row.id }, data: { tokenHash: hashAgencyToken(agencyLinkToken(row)) } });
  });
  if (!created) return { error: `You already have ${limit} live links. Close one first.` } as const;
  const token = agencyLinkToken(created);
  return { link: created, url: tourLinkUrl(webOrigin(), token, tour.agent.publicKey, tour.packageId, travelers), title } as const;
}

router.post("/agency/tour-links", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const parsed = tourLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a tour" });
  const tour = await resolveTour(parsed.data.tourKey);
  if (!tour) return res.status(400).json({ error: "That tour is not available for booking" });
  const identity = await loadPartnerIdentity(db, req.agency.salesPartnerId);
  if (identity && (await partnerIsOperatorReason(db, identity, tour.agent.id))) return res.status(400).json({ error: "You cannot refer clients to your own tour business" });
  const out = await createTourLink(req.agency, parsed.data, tour);
  if ("error" in out) return res.status(409).json({ error: out.error });
  await audit(req, "SALES_AGENCY_TOUR_LINK_CREATE", "SALES_PARTNER", null, { reference: out.link.reference, tourKey: parsed.data.tourKey }, req.agency.salesPartnerId);
  return res.status(201).json({
    link: {
      reference: out.link.reference,
      label: out.link.label,
      kind: "TOUR",
      tour: { title: out.title },
      clientName: out.link.clientName,
      clientPhone: maskClientPhone(out.link.clientPhone),
      expiresAt: out.link.expiresAt,
      maxUses: out.link.maxUses,
      useCount: 0,
      status: "LIVE",
      url: out.url,
    },
  });
}) as RequestHandler);

router.get("/agency/tour-bookings", limitSalesLeadRead, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const partnerId = req.agency.salesPartnerId;
  const rows = await db.tourBookingAttribution.findMany({
    where: { salesPartnerId: partnerId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { link: { select: { label: true } } },
  });
  const ids = rows.map((r: any) => r.tourBookingId);
  const [tours, commissions] = await Promise.all([
    ids.length
      ? db.tourBooking.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, destination: true, startDate: true, travelerCount: true, status: true, paymentStatus: true, grossAmount: true, currency: true, guestName: true },
        })
      : [],
    ids.length
      ? db.salesCommission.findMany({
          where: { salesPartnerId: partnerId, type: "AGENCY_TOUR", sourceKey: { in: ids.map((id: number) => `AGENCY_TOUR:${id}`) } },
          select: { sourceKey: true, status: true, commissionAmount: true, reversalReason: true },
        })
      : [],
  ]);
  const tourById = new Map<number, any>(tours.map((t: any) => [t.id, t]));
  const commissionByKey = new Map<string, any>(commissions.map((c: any) => [c.sourceKey, c]));
  return res.json({
    items: rows.map((r: any) => {
      const t = tourById.get(r.tourBookingId);
      const c = commissionByKey.get(`AGENCY_TOUR:${r.tourBookingId}`);
      return {
        creditedAt: r.createdAt,
        status: r.status,
        blockedReason: r.status === "BLOCKED" ? r.blockedReason : null,
        link: r.link ? { label: r.link.label } : null,
        tour: t
          ? {
              title: t.title,
              destination: t.destination,
              startDate: t.startDate,
              travelers: t.travelerCount,
              status: t.status,
              paid: String(t.paymentStatus).toUpperCase() === "PAID",
              total: Number(t.grossAmount),
              currency: t.currency,
              guest: String(t.guestName || "").trim().split(/\s+/)[0] || null,
            }
          : null,
        commission: c ? { status: c.status, amount: Number(c.commissionAmount), reason: c.status === "REVERSED" ? c.reversalReason : null } : null,
      };
    }),
  });
}) as RequestHandler);

const groupTourSchema = z.object({ tourKey: z.string().max(170), note: z.string().trim().max(500).optional().nullable() }).strict();

router.post("/agency/groups/:ref/tours", blockImpersonated as RequestHandler, limitSalesLeadWrite, requireAgencyDesk(), asyncHandler(async (req: any, res: Response) => {
  const reference = String(req.params.ref || "");
  if (!/^gr_[a-f0-9]{20}$/.test(reference)) return res.status(404).json(NOT_FOUND);
  const request = await db.salesAgencyGroupRequest.findFirst({ where: { reference, salesPartnerId: req.agency.salesPartnerId } });
  if (!request || request.status !== "CONFIRMED" || !request.groupBookingId) return res.status(404).json(NOT_FOUND);
  const parsed = groupTourSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a tour" });
  const tour = await resolveTour(parsed.data.tourKey);
  if (!tour) return res.status(400).json({ error: "That tour is not available for booking" });
  const identity = await loadPartnerIdentity(db, req.agency.salesPartnerId);
  if (identity && (await partnerIsOperatorReason(db, identity, tour.agent.id))) return res.status(400).json({ error: "You cannot refer clients to your own tour business" });
  const gb = await db.groupBooking.findUnique({ where: { id: request.groupBookingId }, select: { id: true, userId: true, headcount: true, status: true } });
  if (!gb) return res.status(404).json(NOT_FOUND);
  if (["CANCELED", "CANCELLED", "EXPIRED"].includes(String(gb.status || "").toUpperCase())) return res.status(409).json({ error: "This group stay is closed" });

  const out = await createTourLink(req.agency, { tourKey: parsed.data.tourKey, clientName: request.clientName, clientPhone: request.clientPhone, travelers: gb.headcount, maxUses: 3 }, tour);
  if ("error" in out) return res.status(409).json({ error: out.error });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: request.salesPartnerId }, select: { agentCode: true } });
  const note = parsed.data.note ? `${sanitizeText(parsed.data.note).slice(0, 500)} ` : "";
  await db.groupBookingMessage.create({
    data: {
      groupBookingId: gb.id,
      senderId: Number(req.user.id),
      senderRole: "SALES_PARTNER",
      senderName: `NoLSAF sales partner ${partner?.agentCode || ""}`.trim(),
      messageType: "Tour suggestion",
      body: `${note}A tour for your group: ${out.title}. Book and pay NoLSAF directly here: ${out.url}`,
      isInternal: false,
    },
  });
  await notifyUser(gb.userId, "group_stay_update", { title: "A tour for your group", body: `Your NoLSAF sales partner suggested ${out.title}. Open your group stay to see it.`, groupBookingId: gb.id }).catch(() => undefined);
  await audit(req, "SALES_AGENCY_GROUP_TOUR", "SALES_PARTNER", null, { reference, linkReference: out.link.reference }, request.salesPartnerId);
  return res.status(201).json({ ok: true, title: out.title });
}) as RequestHandler);

export default router;
