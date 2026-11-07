/**
 * "My team" for sales team leads.
 *
 * GET  /api/sales/team                                 team overview (no money)
 * GET  /api/sales/team/members/:partnerId/leads        a member's open pipeline
 * POST /api/sales/team/leads/:leadId/reassign          move a stuck lead within the team
 * PUT  /api/sales/team/members/:partnerId/target       set a member's monthly target
 *
 * Every request re-checks, on the server, that the caller leads an ACTIVE team
 * and that every partner and lead touched belongs to it. Leads never see
 * earnings, payout details or property contact details, and cannot approve
 * anything or change team membership.
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
import { notifyUser } from "../lib/notifications.js";
import { computeBoard, DEFAULT_MONTHLY_TARGET, monthKey, shiftMonth, TARGET_MAX, TARGET_MIN } from "../lib/salesLeaderboard.js";
import { ledTeamOf, teamMemberIds } from "../lib/salesTeam.js";
import { computeTeamHealth } from "../lib/salesTeamHealth.js";
import { adminTargetFor, assertNoLateRaise, assertWithinLeadRange, TargetRuleError } from "../lib/salesTargets.js";
import {
  INVITE_TTL_DAYS,
  InviteError,
  MAX_OPEN_INVITES,
  MAX_TEAM_SIZE,
  createTeamInvite,
  inviteStatus,
  maskPhone,
  renewTeamInviteLink,
  withdrawTeamInvite,
} from "../lib/salesTeamInvites.js";
import { isCustomerRecordReference } from "../lib/customerBookingReference.js";
import { leadRef, partnerRef, resolveAmong } from "../lib/salesReference.js";

const router = Router();
const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const OPEN_LEAD = { notIn: ["CONVERTED", "LOST", "CANCELLED"] };

type TeamRequest = SalesAuthedRequest & { team?: { id: number; name: string; region: string | null; memberIds: number[]; leadPartnerId: number } };

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"), requireActivePartnerContract);

const requireTeamLead: RequestHandler = (async (req: TeamRequest, res: Response, next: NextFunction) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const team = await ledTeamOf(db, partnerId);
  if (!team) return res.status(403).json({ error: "Only team leads can open My team." });
  req.team = { ...team, memberIds: await teamMemberIds(db, team.id), leadPartnerId: partnerId };
  next();
}) as RequestHandler;

router.use("/team", requireTeamLead);

/** A member reference (sp_…) resolved within the caller's own team only. */
function memberFrom(team: NonNullable<TeamRequest["team"]>, reference: unknown): number | null {
  return resolveAmong("sales-partner", reference, [team.leadPartnerId, ...team.memberIds]);
}

const reassignSchema = z.object({
  toPartner: z.string().trim().max(40),
  reason: z.string().trim().min(5).max(300).transform(sanitizeText),
}).strict();
const targetSchema = z.object({
  month: z.enum(["current", "next"]).default("current"),
  target: z.coerce.number().int().min(TARGET_MIN).max(TARGET_MAX),
}).strict();

/** GET /api/sales/team */
router.get("/team", limitSalesLeaderboard as unknown as RequestHandler, asyncHandler(async (req: TeamRequest, res: Response) => {
  const team = req.team!;
  const month = monthKey();
  const ids = [team.leadPartnerId, ...team.memberIds];
  const staleBefore = new Date(Date.now() - STALE_DAYS * DAY_MS);
  const [partners, board, targets, openLeads, staleLeads, flagged] = await Promise.all([
    db.salesPartnerProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, agentCode: true, level: true, region: true, status: true, user: { select: { name: true, fullName: true, avatarUrl: true } } },
    }),
    computeBoard(month),
    db.salesPartnerMonth.findMany({ where: { salesPartnerId: { in: ids }, month }, select: { salesPartnerId: true, target: true } }),
    db.salesLead.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: ids }, status: OPEN_LEAD }, _count: { _all: true } }),
    db.salesLead.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: ids }, status: OPEN_LEAD, updatedAt: { lt: staleBefore } }, _count: { _all: true } }),
    db.salesLeadVisit.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: ids }, status: "FLAGGED", reviewedAt: null }, _count: { _all: true } }),
  ]);
  const boardOf = new Map(board.map((e) => [e.partnerId, e]));
  const count = (rows: any[]) => new Map<number, number>(rows.map((r) => [r.salesPartnerId, r._count._all]));
  const open = count(openLeads);
  const stale = count(staleLeads);
  const flags = count(flagged);
  const targetOf = new Map<number, number>(targets.map((t: any) => [t.salesPartnerId, t.target ?? DEFAULT_MONTHLY_TARGET]));

  const members = partners
    .map((p: any) => {
      const e = boardOf.get(p.id);
      return {
        ref: partnerRef(p.id),
        isLead: p.id === team.leadPartnerId,
        name: p.user?.fullName || p.user?.name || "Representative",
        avatarUrl: p.user?.avatarUrl || null,
        agentCode: p.agentCode,
        level: p.level,
        region: p.region,
        active: p.status === "ACTIVE",
        nationalRank: e && !e.excluded ? e.rank : null,
        points: e?.points ?? 0,
        confirmed: e?.confirmed ?? 0,
        visits: e?.visits ?? 0,
        target: targetOf.get(p.id) ?? DEFAULT_MONTHLY_TARGET,
        openLeads: open.get(p.id) ?? 0,
        staleLeads: stale.get(p.id) ?? 0,
        flaggedVisits: flags.get(p.id) ?? 0,
      };
    })
    .sort((a: any, b: any) => b.points - a.points);

  const totals = members.reduce(
    (t: any, m: any) => ({ points: t.points + m.points, confirmed: t.confirmed + m.confirmed, target: t.target + m.target, stale: t.stale + m.staleLeads, flagged: t.flagged + m.flaggedVisits }),
    { points: 0, confirmed: 0, target: 0, stale: 0, flagged: 0 },
  );
  // Where this team stands against the other teams this month.
  const teamPoints = new Map<number, number>();
  for (const e of board) if (e.teamId != null && !e.excluded) teamPoints.set(e.teamId, (teamPoints.get(e.teamId) ?? 0) + e.points);
  const teamRank = [...teamPoints.values()].filter((p) => p > (teamPoints.get(team.id) ?? 0)).length + 1;

  res.setHeader("Cache-Control", "no-store");
  res.json({
    team: { id: team.id, name: team.name, region: team.region, month, teamRank, teamCount: Math.max(teamPoints.size, 1) },
    limits: { min: TARGET_MIN, max: TARGET_MAX, staleDays: STALE_DAYS },
    totals,
    members,
  });
}));

/** GET /api/sales/team/health: this team's health only, never other teams' details. */
router.get("/team/health", limitSalesLeaderboard as unknown as RequestHandler, asyncHandler(async (req: TeamRequest, res: Response) => {
  const all = await computeTeamHealth(db);
  const mine = all.find((t) => t.teamId === req.team!.id);
  res.setHeader("Cache-Control", "no-store");
  if (!mine) return res.json({ health: null });
  const { lead: _lead, teamId: _teamId, ...health } = mine;
  res.json({ health: { ...health, position: all.findIndex((t) => t.teamId === req.team!.id) + 1, teamCount: all.length } });
}));

// ---------------------------------------------------------------------------
// Team invites. The lead proposes; only NoLSAF approves.
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  name: z.string().trim().min(3).max(120).transform(sanitizeText),
  phone: z.string().trim().min(9).max(20),
}).strict();
const inviteRef = z.string().trim().regex(/^ti_[A-Za-z0-9_-]{10,29}$/);

function inviteFail(res: Response, error: unknown) {
  if (error instanceof InviteError) return res.status(error.status).json({ error: error.message, code: error.code });
  throw error;
}

/** GET /api/sales/team/invites */
router.get("/team/invites", limitSalesLeaderboard as unknown as RequestHandler, asyncHandler(async (req: TeamRequest, res: Response) => {
  const team = req.team!;
  const now = new Date();
  const rows = await db.salesTeamInvite.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { reference: true, inviteeName: true, inviteePhone: true, status: true, expiresAt: true, openedAt: true, acceptedAt: true, decidedAt: true, joinedAt: true, createdAt: true, decisionNote: true },
  });
  const invites = rows.map((r: any) => ({
    reference: r.reference,
    name: r.inviteeName,
    phone: maskPhone(r.inviteePhone),
    status: inviteStatus(r, now),
    expiresAt: r.expiresAt,
    openedAt: r.openedAt,
    createdAt: r.createdAt,
    acceptedAt: r.acceptedAt,
    decidedAt: r.decidedAt,
    joinedAt: r.joinedAt,
    // Shown to the lead only when NoLSAF closed the invite on its own (team full, disbanded).
    note: r.status === "REJECTED" && r.decisionNote?.startsWith("The ") ? r.decisionNote : null,
  }));
  const open = invites.filter((i: any) => ["SENT", "ACCEPTED", "APPROVED"].includes(i.status)).length;
  const monthStart = new Date(`${monthKey()}-01T00:00:00+03:00`);
  const summary = {
    waiting: invites.filter((i: any) => i.status === "ACCEPTED" || i.status === "APPROVED").length,
    notOpened: invites.filter((i: any) => i.status === "SENT" && !i.openedAt).length,
    joinedThisMonth: invites.filter((i: any) => i.status === "JOINED" && i.joinedAt && new Date(i.joinedAt) >= monthStart).length,
  };
  res.setHeader("Cache-Control", "no-store");
  res.json({
    invites,
    limits: { maxOpen: MAX_OPEN_INVITES, maxTeam: MAX_TEAM_SIZE, ttlDays: INVITE_TTL_DAYS },
    seats: { members: team.memberIds.length, open },
    summary,
  });
}));

/** POST /api/sales/team/invites: returns the link once. */
router.post("/team/invites", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: TeamRequest, res: Response) => {
  const parsed = inviteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Enter the person's full name and mobile number." });
  try {
    const invite = await createTeamInvite(db, { team: { id: req.team!.id, leadPartnerId: req.team!.leadPartnerId }, ...parsed.data });
    await audit(req as any, "SALES_TEAM_INVITE_CREATE", "SALES_TEAM", null, { reference: invite.reference, inviteeName: invite.inviteeName, inviteePhone: maskPhone(invite.inviteePhone) }, req.team!.id);
    res.status(201).json({ invite: { reference: invite.reference, name: invite.inviteeName, phone: maskPhone(invite.inviteePhone), expiresAt: invite.expiresAt, status: "SENT" }, link: invite.link });
  } catch (error) {
    return inviteFail(res, error);
  }
}));

/** POST /api/sales/team/invites/:ref/link: a new link; the old one stops working. */
router.post("/team/invites/:ref/link", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: TeamRequest, res: Response) => {
  const ref = inviteRef.safeParse(req.params.ref);
  if (!ref.success) return res.status(404).json({ error: "Invite not found." });
  try {
    const out = await renewTeamInviteLink(db, { teamId: req.team!.id, reference: ref.data });
    await audit(req as any, "SALES_TEAM_INVITE_RENEW", "SALES_TEAM", null, { reference: ref.data }, req.team!.id);
    res.json(out);
  } catch (error) {
    return inviteFail(res, error);
  }
}));

/** POST /api/sales/team/invites/:ref/withdraw */
router.post("/team/invites/:ref/withdraw", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: TeamRequest, res: Response) => {
  const ref = inviteRef.safeParse(req.params.ref);
  if (!ref.success) return res.status(404).json({ error: "Invite not found." });
  try {
    await withdrawTeamInvite(db, { teamId: req.team!.id, reference: ref.data });
    await audit(req as any, "SALES_TEAM_INVITE_WITHDRAW", "SALES_TEAM", null, { reference: ref.data }, req.team!.id);
    res.json({ ok: true });
  } catch (error) {
    return inviteFail(res, error);
  }
}));

/** GET /api/sales/team/members/:partnerId/leads */
router.get("/team/members/:member/leads", limitSalesLeaderboard as unknown as RequestHandler, asyncHandler(async (req: TeamRequest, res: Response) => {
  const team = req.team!;
  const memberId = memberFrom(team, req.params.member);
  if (!memberId) return res.status(404).json({ error: "Member not found" });
  const leads = await db.salesLead.findMany({
    where: { salesPartnerId: memberId, status: OPEN_LEAD },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: {
      id: true,
      propertyName: true,
      region: true,
      district: true,
      status: true,
      proposedProduct: true,
      nextFollowUpAt: true,
      protectionExpiresAt: true,
      updatedAt: true,
      _count: { select: { visits: true } },
    },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    leads: leads.map((lead: any) => ({
      ref: leadRef(lead.id),
      // Only the lead's own leads open in the portal; members' leads are summaries.
      mine: memberId === team.leadPartnerId,
      propertyName: lead.propertyName,
      area: [lead.district, lead.region].filter(Boolean).join(", ") || null,
      status: lead.status,
      product: lead.proposedProduct,
      nextFollowUpAt: lead.nextFollowUpAt,
      protectionExpiresAt: lead.protectionExpiresAt,
      lastActivityAt: lead.updatedAt,
      visits: lead._count?.visits ?? 0,
      stale: new Date(lead.updatedAt).getTime() < Date.now() - STALE_DAYS * DAY_MS,
      canReassign: lead.status !== "CONVERSION_REQUESTED",
    })),
  });
}));

/** POST /api/sales/team/leads/:leadId/reassign */
router.post("/team/leads/:lead/reassign", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: TeamRequest, res: Response) => {
  const team = req.team!;
  const parsed = reassignSchema.safeParse(req.body);
  if (!isCustomerRecordReference(String(req.params.lead || ""), "sales-lead")) return res.status(404).json({ error: "Lead not found" });
  if (!parsed.success) return res.status(400).json({ error: "Choose a team member and give a reason of at least 5 characters." });
  const allowed = new Set([team.leadPartnerId, ...team.memberIds]);
  const toPartnerId = memberFrom(team, parsed.data.toPartner);
  const { reason } = parsed.data;
  if (!toPartnerId) return res.status(404).json({ error: "That representative is not in your team" });

  // The lead reference is resolved only among leads the team holds.
  const teamLeads = await db.salesLead.findMany({ where: { salesPartnerId: { in: [...allowed] } }, select: { id: true }, orderBy: { id: "desc" }, take: 5000 });
  const leadId = resolveAmong("sales-lead", req.params.lead, teamLeads.map((row: any) => row.id));
  if (!leadId) return res.status(404).json({ error: "Lead not found" });

  const lead = await db.salesLead.findUnique({
    where: { id: leadId },
    select: { id: true, salesPartnerId: true, status: true, propertyName: true, salesPartner: { select: { userId: true } } },
  });
  if (!lead || !allowed.has(lead.salesPartnerId)) return res.status(404).json({ error: "Lead not found" });
  if (lead.salesPartnerId === toPartnerId) return res.status(409).json({ error: "This lead already belongs to that representative" });
  if (["CONVERTED", "LOST", "CANCELLED", "CONVERSION_REQUESTED"].includes(lead.status)) {
    return res.status(409).json({ error: "Only an open lead that is not waiting for conversion can be moved" });
  }
  const target = await db.salesPartnerProfile.findUnique({ where: { id: toPartnerId }, select: { status: true, userId: true, user: { select: { name: true, fullName: true } } } });
  if (!target || target.status !== "ACTIVE") return res.status(409).json({ error: "That representative is not active" });

  const moved = await db.$transaction(async (tx: any) => {
    const changed = await tx.salesLead.updateMany({ where: { id: lead.id, salesPartnerId: lead.salesPartnerId, status: lead.status }, data: { salesPartnerId: toPartnerId } });
    if (changed.count !== 1) return false;
    await tx.salesLeadActivity.create({
      data: {
        leadId: lead.id,
        createdById: req.user!.id,
        type: "NOTE",
        description: `Moved by team lead to ${target.user?.fullName || target.user?.name || "another representative"}. Reason: ${reason}`,
      },
    });
    return true;
  });
  if (!moved) return res.status(409).json({ error: "This lead was changed by someone else. Refresh and try again." });

  await audit(req as any, "SALES_TEAM_LEAD_REASSIGN", "SALES_LEAD", { salesPartnerId: lead.salesPartnerId }, { salesPartnerId: toPartnerId, teamId: team.id, reason }, lead.id);
  await Promise.all([
    notifyUser(lead.salesPartner.userId, "sales_partner_lead_reassigned_away", { propertyName: lead.propertyName, reason }).catch(() => undefined),
    notifyUser(target.userId, "sales_partner_lead_reassigned_to", { propertyName: lead.propertyName, reason, actionPath: `/sales/leads/${leadRef(lead.id)}` }).catch(() => undefined),
  ]);
  res.json({ ok: true });
}));

/** PUT /api/sales/team/members/:partnerId/target */
router.put("/team/members/:member/target", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: TeamRequest, res: Response) => {
  const team = req.team!;
  const memberId = memberFrom(team, req.params.member);
  const parsed = targetSchema.safeParse(req.body);
  if (!memberId) return res.status(404).json({ error: "Member not found" });
  if (!parsed.success) return res.status(400).json({ error: `A target must be between ${TARGET_MIN} and ${TARGET_MAX} confirmed properties.` });
  const month = parsed.data.month === "next" ? shiftMonth(monthKey(), 1) : monthKey();
  // Same fairness rules as admins, plus: an admin's target wins (lead may move it by 2 at most).
  const existing = await db.salesPartnerMonth.findUnique({ where: { salesPartnerId_month: { salesPartnerId: memberId, month } }, select: { target: true } });
  try {
    assertNoLateRaise({ month, current: existing?.target ?? DEFAULT_MONTHLY_TARGET, next: parsed.data.target });
    assertWithinLeadRange(await adminTargetFor(db, memberId, month), parsed.data.target);
  } catch (error) {
    if (error instanceof TargetRuleError) return res.status(409).json({ error: error.message, code: error.code });
    throw error;
  }
  const row = await db.salesPartnerMonth.upsert({
    where: { salesPartnerId_month: { salesPartnerId: memberId, month } },
    create: { salesPartnerId: memberId, month, target: parsed.data.target, targetSetById: req.user!.id, targetSetByRole: "TEAM_LEAD" },
    update: { target: parsed.data.target, targetSetById: req.user!.id, targetSetByRole: "TEAM_LEAD" },
    select: { salesPartner: { select: { userId: true } } },
  });
  await audit(req as any, "SALES_TEAM_TARGET_SET", "SALES_PARTNER", null, { month, target: parsed.data.target, teamId: team.id }, memberId);
  if (memberId !== team.leadPartnerId) {
    await notifyUser(row.salesPartner.userId, "sales_partner_target_set", { month, target: parsed.data.target }).catch(() => undefined);
  }
  res.json({ ok: true, month, target: parsed.data.target });
}));

export default router;
