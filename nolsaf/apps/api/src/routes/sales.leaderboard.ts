/**
 * Leaderboard for sales representatives.
 *
 * GET /api/sales/leaderboard?period=month|quarter|all&scope=national|region|team
 * GET /api/sales/team/status
 *
 * Signed-in partners with a current agreement only. The shared board shows a
 * first name and initial, region, level, points and confirmed properties:
 * never earnings, contacts or anything else.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { partnerIdFor, requireActivePartnerContract, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { limitSalesLeaderboard } from "../middleware/rateLimit.js";
import { aggregateBoard, computeBoard, monthKey, quarterMonths, rankEntries, shiftMonth, targetFor, topTeamOfMonth } from "../lib/salesLeaderboard.js";
import { ledTeamOf, teamIdOf } from "../lib/salesTeam.js";

const router = Router();
const db = prisma as any;
const LIST_LIMIT = 50;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"), requireActivePartnerContract, limitSalesLeaderboard as unknown as RequestHandler);

const querySchema = z.object({
  period: z.enum(["month", "quarter", "all"]).default("month"),
  scope: z.enum(["national", "region", "team"]).default("national"),
});

router.get("/team/status", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const [team, myTeamId, topTeam] = await Promise.all([
    ledTeamOf(db, partnerId),
    teamIdOf(db, partnerId),
    topTeamOfMonth(shiftMonth(monthKey(), -1)).catch(() => null),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    isTeamLead: Boolean(team),
    team,
    // Last month's winning team, and whether it is this partner's team.
    topTeam: topTeam ? { name: topTeam.name, month: topTeam.month, mine: topTeam.teamId === myTeamId } : null,
  });
}));

router.get("/leaderboard", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filter" });
  const { period, scope } = parsed.data;
  const now = new Date();
  const month = monthKey(now);

  const monthBoard = await computeBoard(month);
  const meMonth = monthBoard.find((e) => e.partnerId === partnerId);
  const myTeamId = await teamIdOf(db, partnerId);
  const profile = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { region: true } });

  // Rows for the chosen period, keyed by partner.
  let rows: Array<{ partnerId: number; points: number; confirmed: number; visits: number }>;
  if (period === "month") rows = monthBoard;
  else {
    const months = period === "quarter" ? quarterMonths(month) : await allMonths(month);
    rows = await aggregateBoard(months, month);
  }
  const info = new Map(monthBoard.map((e) => [e.partnerId, e]));
  const scoped = rows.filter((row) => {
    const e = info.get(row.partnerId);
    if (!e || e.excluded) return false;
    if (scope === "region") return Boolean(profile?.region) && e.region === profile.region;
    if (scope === "team") return myTeamId != null && e.teamId === myTeamId;
    return true;
  });
  const ranked = rankEntries(scoped);

  // Movement: national month rank now vs a week ago.
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const before = monthKey(weekAgo) === month ? (await computeBoard(month, weekAgo)).find((e) => e.partnerId === partnerId) : undefined;
  const mine = ranked.find((r) => r.partnerId === partnerId);
  const ahead = mine ? ranked.filter((r) => r.rank < mine.rank).pop() : undefined;

  const target = await targetFor(partnerId, month);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    period,
    scope,
    month,
    hasTeam: myTeamId != null,
    hasRegion: Boolean(profile?.region),
    me: {
      rank: mine?.rank ?? null,
      points: mine?.points ?? 0,
      movement: meMonth && before ? before.rank - meMonth.rank : 0,
      target: { goal: target, confirmed: meMonth?.confirmed ?? 0 },
      gap: ahead && mine ? { rank: ahead.rank, points: ahead.points - mine.points + 1 } : null,
      breakdown: meMonth
        ? { confirmed: meMonth.confirmed, live: meMonth.live, visits: meMonth.visits, revenuePoints: meMonth.revenuePoints, denials: meMonth.denials, reversalPoints: meMonth.reversalPoints }
        : null,
      excluded: Boolean(meMonth?.excluded),
    },
    total: ranked.length,
    entries: ranked
      .filter((r, index) => index < LIST_LIMIT || r.partnerId === partnerId)
      .map((r) => {
        const e = info.get(r.partnerId)!;
        return {
          rank: r.rank,
          name: r.partnerId === partnerId ? `${e.publicName} (you)` : e.publicName,
          initials: e.publicName.replace(/[^A-Za-z ]/g, "").split(" ").map((p) => p[0] || "").join("").slice(0, 2).toUpperCase(),
          region: e.region,
          level: e.level,
          points: r.points,
          confirmed: r.confirmed,
          me: r.partnerId === partnerId,
        };
      }),
  });
}));

async function allMonths(current: string): Promise<string[]> {
  const rows = await db.salesPartnerMonth.findMany({ where: { closedAt: { not: null } }, distinct: ["month"], select: { month: true } });
  return [...new Set([...rows.map((row: any) => row.month), current])];
}

export default router;
