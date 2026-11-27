/**
 * Admin: sales regions and regional leads (docs/SALES_REGIONS.md).
 *
 * GET  /api/admin/sales/regions                    regions with lead, override, people, target vs achieved; unassigned
 * PATCH /api/admin/sales/regions/:code             { name?, status?, leadCode? (null removes) }
 * PUT  /api/admin/sales/regions/:code/override     { percent, reason }  finance code required
 * PUT  /api/admin/sales/regions/:code/target       { month, target | null }
 * POST /api/admin/sales/regions/auto-assign        map partners and teams from their old free-text region
 * POST /api/admin/sales/regions/assign             { kind: PARTNER | TEAM, code (partner agent code or team lead's), region | null }
 *
 * Administrators only, never during an impersonated session, every change audited.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { notifyUser } from "../lib/notifications.js";
import { computeBoard, isMonthKey, monthKey, TARGET_MAX } from "../lib/salesLeaderboard.js";
import { autoAssignRegions, RegionError, regionTarget, setRegionLead } from "../lib/salesRegions.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const codeParam = z.object({ code: z.string().trim().regex(/^[A-Za-z]{2,8}$/).transform((v) => v.toUpperCase()) });

function sendError(res: Response, error: any) {
  if (error instanceof RegionError) return res.status(error.status).json({ error: error.message });
  if (error?.code === "P2021" || error?.code === "P2022") return res.status(503).json({ error: "Sales regions need a database update first.", migrationNeeded: true });
  throw error;
}

async function regionByCode(code: string) {
  const region = await db.salesRegion.findUnique({ where: { code } });
  if (!region) throw new RegionError("Region not found.", 404);
  return region;
}

router.get("/regions", limitSalesAdminRead as any, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  try {
    const month = monthKey();
    const [regions, partners, teams, board] = await Promise.all([
      db.salesRegion.findMany({ orderBy: { id: "asc" } }),
      db.salesPartnerProfile.findMany({
        where: { status: { in: ["ACTIVE", "PENDING", "SUSPENDED"] } },
        select: { id: true, agentCode: true, status: true, region: true, regionId: true, user: { select: { name: true, fullName: true } } },
      }),
      db.salesTeam.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, region: true, regionId: true, lead: { select: { agentCode: true } } } }),
      computeBoard(month),
    ]);
    const confirmedOf = new Map(board.map((e) => [e.partnerId, e.confirmed]));
    const nameOf = (p: any) => p?.user?.fullName || p?.user?.name || p?.agentCode;
    const rows = await Promise.all(regions.map(async (r: any) => {
      const people = partners.filter((p: any) => p.regionId === r.id);
      const ids = people.map((p: any) => p.id);
      const target = await regionTarget(db, r.id, month, ids);
      const lead = people.find((p: any) => p.id === r.leadPartnerId) ?? (r.leadPartnerId ? partners.find((p: any) => p.id === r.leadPartnerId) : null);
      return {
        code: r.code,
        name: r.name,
        status: r.status,
        areas: r.areas,
        overridePercent: Number(r.overridePercent),
        lead: lead ? { code: lead.agentCode, name: nameOf(lead) } : null,
        leadSince: r.leadSince,
        partners: people.filter((p: any) => p.status === "ACTIVE").length,
        teams: teams.filter((t: any) => t.regionId === r.id).length,
        month,
        target: target.target,
        targetSetByAdmin: target.setByAdmin,
        confirmed: ids.reduce((t: number, id: number) => t + Number(confirmedOf.get(id) ?? 0), 0),
      };
    }));
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      month,
      regions: rows,
      unassigned: {
        partners: partners.filter((p: any) => !p.regionId).map((p: any) => ({ code: p.agentCode, name: nameOf(p), region: p.region, status: p.status })),
        teams: teams.filter((t: any) => !t.regionId).map((t: any) => ({ name: t.name, region: t.region, leadCode: t.lead?.agentCode ?? null })),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}));

const patchSchema = z.object({
  name: z.string().trim().min(3).max(80).transform(sanitizeText).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  leadCode: z.string().trim().max(30).nullable().optional(),
}).strict();

router.patch("/regions/:code", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = codeParam.safeParse(req.params);
  const body = patchSchema.safeParse(req.body ?? {});
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });
  try {
    const region = await regionByCode(params.data.code);
    if (body.data.name || body.data.status) {
      await db.salesRegion.update({ where: { id: region.id }, data: { ...(body.data.name ? { name: body.data.name } : {}), ...(body.data.status ? { status: body.data.status } : {}) } });
    }
    let leadId: number | null | undefined;
    if (body.data.leadCode !== undefined) {
      leadId = await setRegionLead(db, region.id, body.data.leadCode || null);
      if (leadId && leadId !== region.leadPartnerId) {
        const lead = await db.salesPartnerProfile.findUnique({ where: { id: leadId }, select: { userId: true } });
        if (lead) await notifyUser(lead.userId, "sales_region_lead_appointed", { regionName: body.data.name ?? region.name, actionPath: "/sales/region" }).catch(() => undefined);
      }
    }
    await audit(req as any, "SALES_REGION_UPDATE", "SALES_REGION", { name: region.name, status: region.status, leadPartnerId: region.leadPartnerId }, { ...body.data, leadPartnerId: leadId }, region.id);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}));

const overrideSchema = z.object({
  percent: z.coerce.number().min(0).max(20),
  reason: z.string().trim().min(5).max(300).transform(sanitizeText),
}).strict();

/** The lead's pay. Money, so it needs the finance code like other rate changes. */
router.put("/regions/:code/override", limitSalesAdminWrite as any, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = codeParam.safeParse(req.params);
  const body = overrideSchema.safeParse(req.body ?? {});
  if (!params.success) return res.status(400).json({ error: "Invalid region" });
  if (!body.success) return res.status(400).json({ error: "Enter a percent from 0 to 20 and a reason." });
  try {
    const region = await regionByCode(params.data.code);
    const percent = Math.round(body.data.percent * 100) / 100;
    await db.salesRegion.update({ where: { id: region.id }, data: { overridePercent: percent } });
    await audit(req as any, "SALES_REGION_OVERRIDE", "SALES_REGION", { overridePercent: Number(region.overridePercent) }, { overridePercent: percent, reason: body.data.reason }, region.id);
    return res.json({ ok: true, overridePercent: percent });
  } catch (error) {
    return sendError(res, error);
  }
}));

const targetSchema = z.object({
  month: z.string().refine(isMonthKey, "Use YYYY-MM"),
  target: z.coerce.number().int().min(1).max(TARGET_MAX * 50).nullable(),
}).strict();

router.put("/regions/:code/target", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = codeParam.safeParse(req.params);
  const body = targetSchema.safeParse(req.body ?? {});
  if (!params.success || !body.success) return res.status(400).json({ error: "Enter a month and a whole-number target." });
  try {
    const region = await regionByCode(params.data.code);
    if (body.data.target === null) {
      await db.salesRegionMonth.deleteMany({ where: { regionId: region.id, month: body.data.month } });
    } else {
      await db.salesRegionMonth.upsert({
        where: { regionId_month: { regionId: region.id, month: body.data.month } },
        create: { regionId: region.id, month: body.data.month, target: body.data.target, setById: req.user!.id },
        update: { target: body.data.target, setById: req.user!.id },
      });
    }
    await audit(req as any, "SALES_REGION_TARGET", "SALES_REGION", null, body.data, region.id);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}));

router.post("/regions/auto-assign", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  try {
    const result = await autoAssignRegions(db);
    await audit(req as any, "SALES_REGION_AUTO_ASSIGN", "SALES_REGION", null, result, null);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}));

const assignSchema = z.object({
  kind: z.enum(["PARTNER", "TEAM"]),
  code: z.string().trim().min(3).max(30),
  region: z.string().trim().regex(/^[A-Za-z]{2,8}$/).nullable(),
}).strict();

router.post("/regions/assign", limitSalesAdminWrite as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = assignSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Invalid request" });
  try {
    const region = body.data.region ? await regionByCode(body.data.region.toUpperCase()) : null;
    const partner = await db.salesPartnerProfile.findUnique({ where: { agentCode: body.data.code.toUpperCase() }, select: { id: true, regionId: true, ledTeam: { select: { id: true, regionId: true } } } });
    if (!partner) throw new RegionError("No Sales Partner has that code.", 404);
    const leads = await db.salesRegion.findFirst({ where: { leadPartnerId: partner.id }, select: { id: true, name: true } });
    if (body.data.kind === "PARTNER") {
      if (leads && leads.id !== region?.id) throw new RegionError(`This partner leads ${leads.name}. Change the lead first.`, 409);
      await db.salesPartnerProfile.update({ where: { id: partner.id }, data: { regionId: region?.id ?? null } });
    } else {
      if (!partner.ledTeam) throw new RegionError("This partner does not lead a team.", 404);
      await db.salesTeam.update({ where: { id: partner.ledTeam.id }, data: { regionId: region?.id ?? null } });
    }
    await audit(req as any, "SALES_REGION_ASSIGN", body.data.kind === "PARTNER" ? "SALES_PARTNER" : "SALES_TEAM", null, { region: region?.code ?? null }, body.data.kind === "PARTNER" ? partner.id : partner.ledTeam!.id);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}));

export default router;
