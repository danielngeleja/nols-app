/**
 * "My region" for Regional leads (docs/SALES_REGIONS.md).
 *
 * GET  /api/sales/region                    the region's dashboard
 * POST /api/sales/region/recommendations     { type: LONG_STAY_REQUEST | SALES_PAYOUT, ref, note? }
 * GET  /api/sales/region/visit-requests       owners asking for a visit in the region
 * POST /api/sales/region/visit-requests/:ref/assign   { agentCode, product? } a region partner, not the lead
 *
 * Every request re-checks on the server that the caller leads an ACTIVE
 * region. A lead sees their region's partners and teams only, never payout
 * account details, and can recommend but never approve.
 */
import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { partnerIdFor, requireActivePartnerContract, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { limitSalesLeaderboard, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { recommend, RegionError, regionDashboard, regionLedBy } from "../lib/salesRegions.js";
import { leadRef } from "../lib/salesReference.js";
import {
  assignVisitRequest,
  findVisitRequest,
  isMissingTable,
  leadVisitView,
  partnerLabels,
  VISIT_PRODUCTS,
  VisitRequestError,
} from "../lib/salesVisitRequests.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"), requireActivePartnerContract);

/** Only a Regional lead gets past here; everyone else sees nothing exists. */
const requireRegionLead: RequestHandler = (async (req: SalesAuthedRequest, res: Response, next: NextFunction) => {
  try {
    const partnerId = partnerIdFor(req);
    const region = partnerId ? await regionLedBy(db, partnerId) : null;
    if (!region) return res.status(404).json({ error: "Not found" });
    (req as any).salesRegion = region;
    return next();
  } catch (error) {
    return next(error);
  }
}) as RequestHandler;

router.get("/region", limitSalesLeaderboard as any, requireRegionLead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await regionDashboard(db, (req as any).salesRegion));
}));

const recommendSchema = z.object({
  type: z.enum(["LONG_STAY_REQUEST", "SALES_PAYOUT"]),
  ref: z.string().trim().min(3).max(60),
  note: z.string().trim().max(300).optional().nullable().transform((v) => (v ? sanitizeText(v) : null)),
}).strict();

router.post("/region/recommendations", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, requireRegionLead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const body = recommendSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Invalid request" });
  const region = (req as any).salesRegion;
  try {
    await recommend(db, region, { subjectType: body.data.type, ref: body.data.ref, note: body.data.note ?? null });
    await audit(req as any, "SALES_REGION_RECOMMEND", "SALES_REGION", null, { type: body.data.type, ref: body.data.ref, note: body.data.note }, region.id);
    await notifyAdmins("sales_region_recommendation", { regionName: region.name, type: body.data.type, ref: body.data.ref }).catch(() => undefined);
    return res.status(201).json({ ok: true });
  } catch (error: any) {
    if (error instanceof RegionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

// ---------- owner visit requests (docs/SALES_VISIT_REQUESTS.md) ----------

/**
 * GET /api/sales/region/visit-requests
 * The region's waiting requests, plus those assigned in the last 30 days, and
 * the partners the lead may assign to. Never the owner's phone or email.
 */
router.get("/region/visit-requests", limitSalesLeaderboard as any, requireRegionLead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const region = (req as any).salesRegion;
  res.setHeader("Cache-Control", "no-store");
  try {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [rows, partners] = await Promise.all([
      db.salesVisitRequest.findMany({
        where: { regionId: region.id, OR: [{ status: "NEW" }, { status: "ASSIGNED", assignedAt: { gte: since } }] },
        orderBy: { id: "desc" },
        take: 100,
      }),
      db.salesPartnerProfile.findMany({
        where: { regionId: region.id, status: "ACTIVE", id: { not: region.leadPartnerId } },
        select: { agentCode: true, user: { select: { name: true, fullName: true } } },
        orderBy: { agentCode: "asc" },
      }),
    ]);
    const labels = await partnerLabels(db, rows.map((r: any) => r.assignedPartnerId));
    return res.json({
      requests: rows.map((row: any) => leadVisitView(row, row.assignedPartnerId ? labels.get(row.assignedPartnerId) ?? null : null)),
      partners: partners.map((p: any) => ({ code: p.agentCode, name: p.user?.fullName || p.user?.name || p.agentCode })),
    });
  } catch (error: any) {
    if (isMissingTable(error)) return res.json({ requests: [], partners: [], unavailable: true });
    throw error;
  }
}));

const assignVisitSchema = z.object({
  agentCode: z.string().trim().min(3).max(30),
  product: z.enum(VISIT_PRODUCTS).optional().nullable(),
}).strict();

/** POST /api/sales/region/visit-requests/:ref/assign  { agentCode, product? } */
router.post("/region/visit-requests/:ref/assign", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, requireRegionLead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const body = assignVisitSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Choose a partner." });
  const region = (req as any).salesRegion;
  try {
    const request = await findVisitRequest(db, String(req.params.ref || ""));
    // Another region's request answers the same as a missing one.
    if (!request || request.regionId !== region.id) return res.status(404).json({ error: "Request not found" });
    const result = await assignVisitRequest(
      db,
      request,
      { agentCode: body.data.agentCode, product: body.data.product ?? null },
      { role: "REGION_LEAD", userId: req.user!.id, region: { id: region.id, name: region.name, leadPartnerId: region.leadPartnerId } },
    );
    await audit(req as any, "SALES_VISIT_REQUEST_ASSIGN", "SALES_VISIT_REQUEST", null, {
      ref: request.publicRef,
      agentCode: result.partner.agentCode,
      byRegionLead: true,
      regionCode: region.code,
      leadId: result.leadId,
      linkedExisting: result.linkedExisting,
    }, request.id);
    await notifyUser(result.partner.userId, "sales_partner_visit_assigned", {
      by: `Your regional lead (${region.name})`,
      propertyName: request.propertyName,
      location: request.location,
      actionPath: `/sales/leads/${leadRef(result.leadId)}`,
    }).catch(() => undefined);
    return res.json({ ok: true, assignedTo: { code: result.partner.agentCode, name: result.partner.name } });
  } catch (error: any) {
    if (error instanceof VisitRequestError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (isMissingTable(error)) return res.status(503).json({ error: "Visit requests are not open yet." });
    throw error;
  }
}));

export default router;
