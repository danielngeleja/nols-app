/**
 * Admin: owners' "Request a NoLSAF visit" queue (docs/SALES_VISIT_REQUESTS.md).
 *
 * GET  /api/admin/sales/visit-requests?status=&region=   the queue, newest first
 * POST /api/admin/sales/visit-requests/:ref/assign       { agentCode, product? }  creates the partner's lead
 * POST /api/admin/sales/visit-requests/:ref/close        { reason }               spam, duplicate, not reachable
 *
 * Addressed by the VR- number, never a row id. Administrators only, never
 * during an impersonated session, every change audited.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { notifyUser } from "../lib/notifications.js";
import { leadRef } from "../lib/salesReference.js";
import {
  adminVisitView,
  assignVisitRequest,
  closeVisitRequest,
  findVisitRequest,
  isMissingTable,
  partnerLabels,
  VISIT_PRODUCTS,
  VISIT_STATUSES,
  VisitRequestError,
} from "../lib/salesVisitRequests.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

function sendError(res: Response, error: any) {
  if (error instanceof VisitRequestError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (isMissingTable(error)) return res.status(503).json({ error: "Visit requests need a database update first.", migrationNeeded: true });
  throw error;
}

const listSchema = z.object({
  status: z.enum(VISIT_STATUSES).optional(),
  region: z.string().trim().regex(/^[A-Za-z]{2,8}$/).transform((v) => v.toUpperCase()).optional(),
});

router.get("/visit-requests", limitSalesAdminRead as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filter" });
  try {
    const regions = await db.salesRegion.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } });
    const regionByCode = new Map(regions.map((r: any) => [r.code, r]));
    const regionName = new Map(regions.map((r: any) => [r.id, r.name]));
    const where: any = {};
    if (parsed.data.status) where.status = parsed.data.status;
    if (parsed.data.region === "NONE") where.regionId = null;
    else if (parsed.data.region) where.regionId = (regionByCode.get(parsed.data.region) as any)?.id ?? -1;

    const [rows, counts] = await Promise.all([
      db.salesVisitRequest.findMany({ where, orderBy: { id: "desc" }, take: 200 }),
      db.salesVisitRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const labels = await partnerLabels(db, rows.map((r: any) => r.assignedPartnerId));
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      counts: Object.fromEntries(VISIT_STATUSES.map((s) => [s, Number(counts.find((c: any) => c.status === s)?._count?._all ?? 0)])),
      regions: regions.map((r: any) => ({ code: r.code, name: r.name })),
      requests: rows.map((row: any) => ({
        ...adminVisitView(row, {
          regionName: row.regionId ? String(regionName.get(row.regionId) ?? "") || null : null,
          partner: row.assignedPartnerId ? labels.get(row.assignedPartnerId) ?? null : null,
        }),
        leadRef: row.leadId ? leadRef(row.leadId) : null,
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
}));

const assignSchema = z.object({
  agentCode: z.string().trim().min(3).max(30),
  product: z.enum(VISIT_PRODUCTS).optional().nullable(),
}).strict();

router.post("/visit-requests/:ref/assign", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = assignSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Enter the partner's agent code." });
  try {
    const request = await findVisitRequest(db, String(req.params.ref || ""));
    if (!request) return res.status(404).json({ error: "Request not found" });
    const result = await assignVisitRequest(db, request, { agentCode: body.data.agentCode, product: body.data.product ?? null }, { role: "ADMIN", userId: req.user!.id });
    await audit(req as any, "SALES_VISIT_REQUEST_ASSIGN", "SALES_VISIT_REQUEST", null, {
      ref: request.publicRef,
      agentCode: result.partner.agentCode,
      leadId: result.leadId,
      linkedExisting: result.linkedExisting,
    }, request.id);
    await notifyUser(result.partner.userId, "sales_partner_visit_assigned", {
      by: "NoLSAF",
      propertyName: request.propertyName,
      location: request.location,
      actionPath: `/sales/leads/${leadRef(result.leadId)}`,
    }).catch(() => undefined);
    return res.json({ ok: true, assignedTo: { code: result.partner.agentCode, name: result.partner.name }, possibleDuplicate: result.possibleDuplicate, linkedExisting: result.linkedExisting });
  } catch (error) {
    return sendError(res, error);
  }
}));

const closeSchema = z.object({ reason: z.string().trim().min(3).max(300).transform((v) => sanitizeText(v).trim()) }).strict();

router.post("/visit-requests/:ref/close", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = closeSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Give a short reason." });
  try {
    const request = await findVisitRequest(db, String(req.params.ref || ""));
    if (!request) return res.status(404).json({ error: "Request not found" });
    await closeVisitRequest(db, request, body.data.reason, req.user!.id);
    await audit(req as any, "SALES_VISIT_REQUEST_CLOSE", "SALES_VISIT_REQUEST", null, { ref: request.publicRef, reason: body.data.reason }, request.id);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}));

export default router;
