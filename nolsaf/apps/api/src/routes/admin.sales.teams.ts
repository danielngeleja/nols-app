/**
 * Admin: sales teams, targets and the full leaderboard.
 *
 * GET  /api/admin/sales/teams
 * POST /api/admin/sales/partners/:id/team-lead            appoint (creates the team)
 * POST /api/admin/sales/partners/:id/team-lead/remove     remove (team disbanded)
 * POST /api/admin/sales/teams/:id/members                 add a partner
 * POST /api/admin/sales/teams/:id/members/:partnerId/remove
 * PUT  /api/admin/sales/partners/:id/target               set a monthly target
 * GET  /api/admin/sales/leaderboard?month=YYYY-MM          full names and breakdown
 * POST /api/admin/sales/leaderboard/exclude               remove a partner from a month's board
 * POST /api/admin/sales/leaderboard/restore
 *
 * Administrators only, never during an impersonated session, rate limited,
 * every change audited with a reason.
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
import { CONTRACT_EARNING_STATUSES } from "../lib/salesPartner.js";
import { clearBoardCache, computeBoard, DEFAULT_MONTHLY_TARGET, isMonthKey, monthKey, shiftMonth, TARGET_MAX, TARGET_MIN, topTeamOfMonth } from "../lib/salesLeaderboard.js";
import { assertNoLateRaise, nextMonthSuggestions, presetValue, targetContext, TargetRuleError } from "../lib/salesTargets.js";
import { inviteStatus, maskPhone, profileGaps } from "../lib/salesTeamInvites.js";
import { computeTeamHealth } from "../lib/salesTeamHealth.js";
import { placeSalesPayoutHold } from "../services/payouts/salesWithdrawal.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const reason = z.string().trim().min(5).max(300).transform(sanitizeText);
const idParams = z.object({ id: z.coerce.number().int().positive() });
const memberParams = z.object({ id: z.coerce.number().int().positive(), partnerId: z.coerce.number().int().positive() });

class TeamError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function fail(res: Response, error: unknown) {
  if (error instanceof TeamError) return res.status(error.status).json({ error: error.message });
  throw error;
}

const nameOf = (p: any) => p?.user?.fullName || p?.user?.name || "Representative";

/** Active partner with a current agreement: the bar for leading and for joining a team. */
async function activePartner(tx: any, partnerId: number) {
  const now = new Date();
  const partner = await tx.salesPartnerProfile.findUnique({
    where: { id: partnerId },
    select: {
      id: true,
      userId: true,
      status: true,
      region: true,
      user: { select: { name: true, fullName: true } },
      contracts: { where: { status: { in: [...CONTRACT_EARNING_STATUSES] }, startsAt: { lte: now }, expiresAt: { gt: now } }, take: 1, select: { id: true } },
    },
  });
  if (!partner) throw new TeamError("Sales partner not found", 404);
  if (partner.status !== "ACTIVE" || !partner.contracts.length) throw new TeamError("Only an active partner with a current agreement can do this");
  return partner;
}

/** GET /api/admin/sales/teams */
router.get("/teams", limitSalesAdminRead, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const [teams, board] = await Promise.all([
    db.salesTeam.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        region: true,
        createdAt: true,
        lead: { select: { id: true, agentCode: true, region: true, user: { select: { name: true, fullName: true } } } },
        members: {
          where: { activeKey: { not: null } },
          select: { joinedAt: true, salesPartner: { select: { id: true, agentCode: true, region: true, status: true, user: { select: { name: true, fullName: true } } } } },
        },
      },
    }),
    computeBoard(monthKey()),
  ]);
  const boardOf = new Map(board.map((e) => [e.partnerId, e]));
  const out = teams.map((team: any) => {
    const ids = [team.lead.id, ...team.members.map((m: any) => m.salesPartner.id)];
    const points = ids.reduce((sum: number, id: number) => sum + (boardOf.get(id)?.excluded ? 0 : boardOf.get(id)?.points ?? 0), 0);
    return {
      id: team.id,
      name: team.name,
      region: team.region,
      createdAt: team.createdAt,
      points,
      lead: { partnerId: team.lead.id, name: nameOf(team.lead), agentCode: team.lead.agentCode, points: boardOf.get(team.lead.id)?.points ?? 0 },
      members: team.members.map((m: any) => ({
        partnerId: m.salesPartner.id,
        name: nameOf(m.salesPartner),
        agentCode: m.salesPartner.agentCode,
        region: m.salesPartner.region,
        status: m.salesPartner.status,
        joinedAt: m.joinedAt,
        points: boardOf.get(m.salesPartner.id)?.points ?? 0,
      })),
    };
  });
  out.sort((a: any, b: any) => b.points - a.points);
  const top = await topTeamOfMonth(shiftMonth(monthKey(), -1)).catch(() => null);
  res.json({
    teams: out.map((t: any, i: number) => ({ ...t, rank: i + 1, topTeam: top && top.teamId === t.id ? { month: top.month } : null })),
    topTeam: top ? { name: top.name, month: top.month } : null,
  });
}));

// ---------------------------------------------------------------------------
// Team invites waiting for NoLSAF. Approve = promote the recruit with the
// invite reference (admin.sales.partners.ts); they join at activation.
// ---------------------------------------------------------------------------

const inviteRefSchema = z.string().trim().regex(/^ti_[A-Za-z0-9_-]{10,29}$/);

/** GET /api/admin/sales/team-invites?status=ACCEPTED */
router.get("/team-invites", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = z.enum(["ACCEPTED", "APPROVED", "JOINED", "REJECTED", "ALL"]).catch("ACCEPTED").parse(req.query.status);
  const rows = await db.salesTeamInvite.findMany({
    where: status === "ALL" ? {} : { status },
    orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      reference: true, status: true, inviteeName: true, inviteePhone: true, expiresAt: true, acceptedUserId: true, acceptedAt: true,
      flags: true, decidedAt: true, decisionNote: true, createdAt: true,
      team: { select: { name: true, region: true, lead: { select: { id: true, agentCode: true, payoutHoldAt: true, region: true, territory: true, user: { select: { name: true, fullName: true } } } } } },
    },
  });
  const userIds = rows.map((r: any) => r.acceptedUserId).filter(Boolean);
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, fullName: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true, address: true, nin: true, createdAt: true },
      })
    : [];
  const userOf = new Map<number, any>(users.map((u: any) => [u.id, u]));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    invites: rows.map((r: any) => {
      const u = r.acceptedUserId ? userOf.get(r.acceptedUserId) : null;
      return {
        reference: r.reference,
        status: inviteStatus(r, new Date()),
        inviteeName: r.inviteeName,
        invitedPhone: maskPhone(r.inviteePhone),
        acceptedAt: r.acceptedAt,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        flags: Array.isArray(r.flags) ? r.flags : [],
        team: { name: r.team.name, region: r.team.region },
        lead: { name: nameOf(r.team.lead), agentCode: r.team.lead.agentCode, paused: Boolean(r.team.lead.payoutHoldAt), region: r.team.lead.region, territory: r.team.lead.territory },
        // The account that accepted: what the admin needs to approve and promote.
        recruit: u
          ? {
              userId: u.id,
              name: u.fullName || u.name || r.inviteeName,
              email: u.email,
              phone: u.phone,
              joinedNolsafAt: u.createdAt,
              missing: profileGaps(u),
            }
          : null,
      };
    }),
  });
}));

/** POST /api/admin/sales/team-invites/:ref/reject  { reason, pauseLead? } */
router.post("/team-invites/:ref/reject", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ref = inviteRefSchema.safeParse(req.params.ref);
  const parsed = z.object({ reason, pauseLead: z.boolean().optional() }).strict().safeParse(req.body);
  if (!ref.success) return res.status(404).json({ error: "Invite not found" });
  if (!parsed.success) return res.status(400).json({ error: "Give a reason of at least 5 characters" });
  const invite = await db.salesTeamInvite.findUnique({
    where: { reference: ref.data },
    select: { id: true, status: true, acceptedUserId: true, inviteeName: true, leadPartnerId: true, team: { select: { name: true, lead: { select: { userId: true } } } } },
  });
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  const now = new Date();
  const changed = await db.salesTeamInvite.updateMany({
    where: { id: invite.id, status: { in: ["SENT", "ACCEPTED"] } },
    data: { status: "REJECTED", decidedAt: now, decidedById: req.user!.id, decisionNote: parsed.data.reason },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "Only an invite still waiting can be rejected" });
  if (parsed.data.pauseLead) {
    await placeSalesPayoutHold(invite.leadPartnerId, req.user!.id, `Team invite rejected: ${parsed.data.reason}`).catch(() => undefined);
  }
  await audit(req, "SALES_TEAM_INVITE_REJECT", "SALES_TEAM_INVITE", { status: invite.status }, { status: "REJECTED", reason: parsed.data.reason, pauseLead: Boolean(parsed.data.pauseLead) }, invite.id);
  await notifyUser(invite.team.lead.userId, "sales_partner_team_invite_rejected", { inviteeName: invite.inviteeName, teamName: invite.team.name }).catch(() => undefined);
  if (invite.acceptedUserId) {
    await notifyUser(invite.acceptedUserId, "sales_team_invite_declined", { teamName: invite.team.name }).catch(() => undefined);
  }
  res.json({ ok: true });
}));

/** GET /api/admin/sales/team-health: every active team, healthiest first, with reasons. */
router.get("/team-health", limitSalesAdminRead, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const teams = await computeTeamHealth(db);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    teams: teams.map(({ lead, ...t }) => ({ ...t, lead: { name: lead.name, agentCode: lead.agentCode } })),
    counts: {
      STRONG: teams.filter((t) => t.label === "STRONG").length,
      STEADY: teams.filter((t) => t.label === "STEADY").length,
      NEEDS_SUPPORT: teams.filter((t) => t.label === "NEEDS_SUPPORT").length,
      AT_RISK: teams.filter((t) => t.label === "AT_RISK").length,
    },
  });
}));

/** POST /api/admin/sales/partners/:id/team-lead */
router.post("/partners/:id/team-lead", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = z.object({ reason, name: z.string().trim().min(2).max(120).transform(sanitizeText).optional() }).strict().safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid partner id" });
  if (!parsed.success) return res.status(400).json({ error: "Give a reason of at least 5 characters" });
  const partnerId = params.data.id;
  try {
    const result = await db.$transaction(async (tx: any) => {
      const partner = await activePartner(tx, partnerId);
      // Good standing: no claim on hold after an owner's "no", no flagged visit waiting for review.
      const [disputed, flagged] = await Promise.all([
        tx.propertySalesAttribution.count({ where: { salesPartnerId: partnerId, status: "DISPUTED" } }),
        tx.salesLeadVisit.count({ where: { salesPartnerId: partnerId, status: "FLAGGED", reviewedAt: null } }),
      ]);
      if (disputed) throw new TeamError("This partner has a property on hold after an owner did not confirm them. Resolve it first.");
      if (flagged) throw new TeamError("This partner has flagged visits waiting for review. Review them first.");
      const existing = await tx.salesTeam.findUnique({ where: { leadPartnerId: partnerId }, select: { id: true, status: true } });
      if (existing?.status === "ACTIVE") throw new TeamError("This partner already leads a team");
      // A lead leaves any team they were a member of.
      await tx.salesTeamMember.updateMany({ where: { activeKey: partnerId }, data: { activeKey: null, leftAt: new Date() } });
      const name = parsed.data.name || `${nameOf(partner).split(" ")[0]}'s team`;
      const team = existing
        ? await tx.salesTeam.update({ where: { id: existing.id }, data: { status: "ACTIVE", name, region: partner.region, disbandedAt: null, createdById: req.user!.id } })
        : await tx.salesTeam.create({ data: { leadPartnerId: partnerId, name, region: partner.region, createdById: req.user!.id } });
      return { team, partner };
    });
    clearBoardCache();
    await audit(req, "SALES_TEAM_LEAD_APPOINT", "SALES_TEAM", null, { leadPartnerId: partnerId, name: result.team.name, reason: parsed.data.reason }, result.team.id);
    await notifyUser(result.partner.userId, "sales_partner_team_lead_appointed", { teamName: result.team.name, actionPath: "/sales/team" }).catch(() => undefined);
    res.status(201).json({ ok: true, team: { id: result.team.id, name: result.team.name } });
  } catch (error) {
    return fail(res, error);
  }
}));

/** POST /api/admin/sales/partners/:id/team-lead/remove */
router.post("/partners/:id/team-lead/remove", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid partner id" });
  if (!parsed.success) return res.status(400).json({ error: "Give a reason of at least 5 characters" });
  const team = await db.salesTeam.findUnique({
    where: { leadPartnerId: params.data.id },
    select: { id: true, name: true, status: true, lead: { select: { userId: true } }, members: { where: { activeKey: { not: null } }, select: { salesPartner: { select: { userId: true } } } } },
  });
  if (!team || team.status !== "ACTIVE") return res.status(404).json({ error: "This partner does not lead a team" });
  const now = new Date();
  await db.$transaction(async (tx: any) => {
    await tx.salesTeam.update({ where: { id: team.id }, data: { status: "DISBANDED", disbandedAt: now } });
    await tx.salesTeamMember.updateMany({ where: { teamId: team.id, activeKey: { not: null } }, data: { activeKey: null, leftAt: now } });
  });
  clearBoardCache();
  await audit(req, "SALES_TEAM_LEAD_REMOVE", "SALES_TEAM", { status: "ACTIVE" }, { status: "DISBANDED", reason: parsed.data.reason }, team.id);
  await notifyUser(team.lead.userId, "sales_partner_team_lead_removed", { teamName: team.name, reason: parsed.data.reason }).catch(() => undefined);
  for (const m of team.members) await notifyUser(m.salesPartner.userId, "sales_partner_team_left", { teamName: team.name }).catch(() => undefined);
  res.json({ ok: true });
}));

/** POST /api/admin/sales/teams/:id/members */
router.post("/teams/:id/members", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = z.object({ salesPartnerId: z.coerce.number().int().positive(), reason }).strict().safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid team id" });
  if (!parsed.success) return res.status(400).json({ error: "Choose a partner and give a reason of at least 5 characters" });
  const { salesPartnerId } = parsed.data;
  try {
    const result = await db.$transaction(async (tx: any) => {
      const team = await tx.salesTeam.findUnique({ where: { id: params.data.id }, select: { id: true, name: true, status: true, leadPartnerId: true, lead: { select: { userId: true } } } });
      if (!team || team.status !== "ACTIVE") throw new TeamError("Team not found", 404);
      if (team.leadPartnerId === salesPartnerId) throw new TeamError("The team lead is not added as a member");
      const partner = await activePartner(tx, salesPartnerId);
      const leads = await tx.salesTeam.findUnique({ where: { leadPartnerId: salesPartnerId }, select: { status: true } });
      if (leads?.status === "ACTIVE") throw new TeamError("This partner leads another team");
      const current = await tx.salesTeamMember.findUnique({ where: { activeKey: salesPartnerId }, select: { teamId: true } });
      if (current) throw new TeamError(current.teamId === team.id ? "Already in this team" : "This partner is in another team. Remove them there first.");
      await tx.salesTeamMember.create({ data: { teamId: team.id, salesPartnerId, activeKey: salesPartnerId, addedById: req.user!.id } });
      return { team, partner };
    });
    clearBoardCache();
    await audit(req, "SALES_TEAM_MEMBER_ADD", "SALES_TEAM", null, { salesPartnerId, reason: parsed.data.reason }, result.team.id);
    await notifyUser(result.partner.userId, "sales_partner_team_joined", { teamName: result.team.name }).catch(() => undefined);
    res.status(201).json({ ok: true });
  } catch (error) {
    return fail(res, error);
  }
}));

/** POST /api/admin/sales/teams/:id/members/:partnerId/remove */
router.post("/teams/:id/members/:partnerId/remove", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = memberParams.safeParse(req.params);
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid request" });
  if (!parsed.success) return res.status(400).json({ error: "Give a reason of at least 5 characters" });
  const membership = await db.salesTeamMember.findUnique({
    where: { activeKey: params.data.partnerId },
    select: { id: true, teamId: true, team: { select: { name: true } }, salesPartner: { select: { userId: true } } },
  });
  if (!membership || membership.teamId !== params.data.id) return res.status(404).json({ error: "This partner is not in this team" });
  await db.salesTeamMember.update({ where: { id: membership.id }, data: { activeKey: null, leftAt: new Date() } });
  clearBoardCache();
  await audit(req, "SALES_TEAM_MEMBER_REMOVE", "SALES_TEAM", null, { salesPartnerId: params.data.partnerId, reason: parsed.data.reason }, params.data.id);
  await notifyUser(membership.salesPartner.userId, "sales_partner_team_left", { teamName: membership.team.name }).catch(() => undefined);
  res.json({ ok: true });
}));

/** PUT /api/admin/sales/partners/:id/target */
/** GET /api/admin/sales/partners/:id/target-context: history, peers and suggested choices. */
router.get("/partners/:id/target-context", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid partner id" });
  const context = await targetContext(db, params.data.id);
  if (!context) return res.status(404).json({ error: "Sales partner not found" });
  res.setHeader("Cache-Control", "no-store");
  res.json(context);
}));

/**
 * PUT /api/admin/sales/partners/:id/target  { month, target, choice?, reason? }
 * A preset choice (SUGGESTED, KEEP, STRETCH) needs no typed reason: the
 * server checks the number matches the choice and records why. CUSTOM needs one.
 */
router.put("/partners/:id/target", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = z.object({
    month: z.string().refine(isMonthKey),
    target: z.coerce.number().int().min(TARGET_MIN).max(TARGET_MAX),
    choice: z.enum(["SUGGESTED", "KEEP", "STRETCH", "CUSTOM"]).default("CUSTOM"),
    reason: reason.optional(),
  }).strict().safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid partner id" });
  if (!parsed.success) return res.status(400).json({ error: `Target must be ${TARGET_MIN} to ${TARGET_MAX}, with a month` });
  const { month, target, choice } = parsed.data;
  if (month < monthKey()) return res.status(409).json({ error: "A past month's target cannot be changed" });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: params.data.id }, select: { userId: true } });
  if (!partner) return res.status(404).json({ error: "Sales partner not found" });

  const context = await targetContext(db, params.data.id);
  const currentForMonth = month === context?.month ? context.thisMonth.target : context?.nextMonthTarget?.target ?? DEFAULT_MONTHLY_TARGET;
  let why = parsed.data.reason;
  if (choice !== "CUSTOM") {
    // KEEP means the target already set for the chosen month.
    const expected = !context ? null : choice === "KEEP" ? currentForMonth : presetValue(choice, context.choices);
    if (expected !== target) return res.status(409).json({ error: "The suggestion changed. Reload and choose again." });
    why = why || (choice === "SUGGESTED" ? `Suggested from the last 3 months (average ${context!.choices.average})` : choice === "KEEP" ? "Kept the current target" : "Stretch target: suggested plus 2");
  } else if (!why) {
    return res.status(400).json({ error: "Give a reason for a custom target" });
  }
  try {
    assertNoLateRaise({ month, current: currentForMonth, next: target });
  } catch (error) {
    if (error instanceof TargetRuleError) return res.status(409).json({ error: error.message, code: error.code });
    throw error;
  }

  await db.salesPartnerMonth.upsert({
    where: { salesPartnerId_month: { salesPartnerId: params.data.id, month } },
    create: { salesPartnerId: params.data.id, month, target, targetSetById: req.user!.id, targetSetByRole: "ADMIN" },
    update: { target, targetSetById: req.user!.id, targetSetByRole: "ADMIN" },
  });
  await audit(req, "SALES_TARGET_SET", "SALES_PARTNER", { target: currentForMonth }, { month, target, choice, reason: why }, params.data.id);
  await notifyUser(partner.userId, "sales_partner_target_set", { month, target, reason: why }).catch(() => undefined);
  res.json({ ok: true, month, target });
}));

/** GET /api/admin/sales/targets/next-month: a suggested target for every active partner. */
router.get("/targets/next-month", limitSalesAdminRead, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await nextMonthSuggestions(db));
}));

/** POST /api/admin/sales/targets/next-month  { items: [{ partnerId, target }] }: approve in one go. */
router.post("/targets/next-month", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = z.object({
    items: z.array(z.object({ partnerId: z.coerce.number().int().positive(), target: z.coerce.number().int().min(TARGET_MIN).max(TARGET_MAX) }).strict()).min(1).max(1000),
  }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Each target must be ${TARGET_MIN} to ${TARGET_MAX}` });
  const month = shiftMonth(monthKey(), 1);
  const suggestions = await nextMonthSuggestions(db);
  const known = new Map<number, any>(suggestions.partners.map((p: any) => [p.partnerId, p]));
  const items = parsed.data.items.filter((i) => known.has(i.partnerId));
  if (!items.length) return res.status(409).json({ error: "None of these partners are active any more. Reload." });

  await db.$transaction(async (tx: any) => {
    for (const item of items) {
      await tx.salesPartnerMonth.upsert({
        where: { salesPartnerId_month: { salesPartnerId: item.partnerId, month } },
        create: { salesPartnerId: item.partnerId, month, target: item.target, targetSetById: req.user!.id, targetSetByRole: "ADMIN" },
        update: { target: item.target, targetSetById: req.user!.id, targetSetByRole: "ADMIN" },
      });
      const p = known.get(item.partnerId);
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role || "ADMIN", action: "SALES_TARGET_BULK_SET", entity: "SALES_PARTNER", entityId: item.partnerId,
        afterJson: { month, target: item.target, suggested: p.suggested, reason: item.target === p.suggested ? "Approved the suggested target" : "Adjusted during bulk approval" },
      } });
    }
  });
  const users = await db.salesPartnerProfile.findMany({ where: { id: { in: items.map((i) => i.partnerId) } }, select: { id: true, userId: true } });
  const userOf = new Map<number, number>(users.map((u: any) => [u.id, u.userId]));
  for (const item of items) {
    const userId = userOf.get(item.partnerId);
    if (userId) await notifyUser(userId, "sales_partner_target_set", { month, target: item.target }).catch(() => undefined);
  }
  res.json({ ok: true, month, count: items.length });
}));

/** GET /api/admin/sales/leaderboard?month=YYYY-MM */
router.get("/leaderboard", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const requested = String(req.query.month || "");
  const month = isMonthKey(requested) ? requested : monthKey();
  const current = monthKey();
  if (month > current) return res.status(400).json({ error: "That month has not started" });

  const [partners, rows] = await Promise.all([
    db.salesPartnerProfile.findMany({ select: { id: true, agentCode: true, region: true, level: true, user: { select: { name: true, fullName: true } } } }),
    db.salesPartnerMonth.findMany({ where: { month }, select: { salesPartnerId: true, target: true, excludedAt: true, excludedReason: true, finalRank: true, finalPoints: true, finalBreakdown: true, badges: true, closedAt: true } }),
  ]);
  const partnerOf = new Map(partners.map((p: any) => [p.id, p]));
  const rowOf = new Map(rows.map((r: any) => [r.salesPartnerId, r]));
  const closed = rows.some((r: any) => r.closedAt);

  let entries: any[];
  if (month === current || !closed) {
    const board = await computeBoard(month);
    const excludedIds = board.filter((e) => e.excluded).map((e) => e.partnerId);
    entries = [...board, ...board.filter((e) => e.excluded)].filter((e, i, all) => all.findIndex((x) => x.partnerId === e.partnerId) === i)
      .map((e) => ({ partnerId: e.partnerId, rank: excludedIds.includes(e.partnerId) ? null : e.rank, points: e.points, breakdown: { confirmed: e.confirmed, live: e.live, visits: e.visits, flaggedVisits: e.flaggedVisits, revenuePoints: e.revenuePoints, denials: e.denials, reversalPoints: e.reversalPoints }, teamId: e.teamId }));
    const boardIds = new Set(board.map((e) => e.partnerId));
    for (const r of rows) if (r.excludedAt && !boardIds.has(r.salesPartnerId)) entries.push({ partnerId: r.salesPartnerId, rank: null, points: 0, breakdown: null, teamId: null });
  } else {
    entries = rows.filter((r: any) => r.closedAt || r.excludedAt).map((r: any) => ({ partnerId: r.salesPartnerId, rank: r.excludedAt ? null : r.finalRank, points: r.finalPoints ?? 0, breakdown: r.finalBreakdown, teamId: null }));
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    month,
    live: month === current,
    closed,
    entries: entries
      .map((e) => {
        const p: any = partnerOf.get(e.partnerId);
        const r: any = rowOf.get(e.partnerId);
        return {
          ...e,
          name: nameOf(p),
          agentCode: p?.agentCode,
          region: p?.region ?? null,
          level: p?.level ?? null,
          target: r?.target ?? null,
          excluded: Boolean(r?.excludedAt),
          excludedReason: r?.excludedReason ?? null,
          badges: r?.badges ?? [],
        };
      })
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)),
  });
}));

const exclusionSchema = z.object({ salesPartnerId: z.coerce.number().int().positive(), month: z.string().refine(isMonthKey), reason }).strict();

/** POST /api/admin/sales/leaderboard/exclude */
router.post("/leaderboard/exclude", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = exclusionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a partner and month, and give a reason of at least 5 characters" });
  const { salesPartnerId, month } = parsed.data;
  if (month !== monthKey()) return res.status(409).json({ error: "Only the current month can be changed" });
  await db.salesPartnerMonth.upsert({
    where: { salesPartnerId_month: { salesPartnerId, month } },
    create: { salesPartnerId, month, excludedAt: new Date(), excludedById: req.user!.id, excludedReason: parsed.data.reason },
    update: { excludedAt: new Date(), excludedById: req.user!.id, excludedReason: parsed.data.reason },
  });
  clearBoardCache();
  await audit(req, "SALES_LEADERBOARD_EXCLUDE", "SALES_PARTNER", null, { month, reason: parsed.data.reason }, salesPartnerId);
  res.json({ ok: true });
}));

/** POST /api/admin/sales/leaderboard/restore */
router.post("/leaderboard/restore", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = exclusionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a partner and month, and give a reason of at least 5 characters" });
  const { salesPartnerId, month } = parsed.data;
  if (month !== monthKey()) return res.status(409).json({ error: "Only the current month can be changed" });
  await db.salesPartnerMonth.updateMany({ where: { salesPartnerId, month }, data: { excludedAt: null, excludedById: null, excludedReason: null } });
  clearBoardCache();
  await audit(req, "SALES_LEADERBOARD_RESTORE", "SALES_PARTNER", null, { month, reason: parsed.data.reason }, salesPartnerId);
  res.json({ ok: true });
}));

export default router;
