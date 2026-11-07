/**
 * Team health: which sales teams are doing well, and why.
 *
 * Team points alone reward size (ten average people beat three excellent
 * ones), so health looks at five things, all from data we already hold:
 *
 *   per member   last finished month's points per active member (fair to small teams)
 *   conversion   owner-confirmed properties / leads opened, last 90 days
 *   quality      owner denials, reversed earnings and flagged visits per member
 *   activity     share of open leads that are not stuck (no activity 14+ days)
 *   trend        last month per member against the three months before it
 *
 * Each team gets a label (STRONG, STEADY, NEEDS_SUPPORT, AT_RISK), a 0-100
 * score for ordering, and the reasons in plain words, the main one first.
 * Read only; carries no money.
 */
import { computeBoard, monthKey, shiftMonth, type BoardEntry } from "./salesLeaderboard.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const OPEN_LEAD = { notIn: ["CONVERTED", "LOST", "CANCELLED"] };
const MIN_LEADS_FOR_CONVERSION = 5;

export type HealthLabel = "STRONG" | "STEADY" | "NEEDS_SUPPORT" | "AT_RISK";

export type TeamHealth = {
  teamId: number;
  name: string;
  region: string | null;
  lead: { partnerId: number; userId: number; name: string; agentCode: string };
  members: number;
  label: HealthLabel;
  score: number;
  reasons: string[];
  /** One concrete thing the lead can do this week. */
  tip: string | null;
  metrics: {
    pointsThisMonth: number;
    perMemberLastMonth: number;
    perMemberBefore: number | null;
    trendPercent: number | null;
    conversionPercent: number | null;
    leadsOpened90d: number;
    confirmed90d: number;
    qualityIssues: number;
    pausedMembers: number;
    openLeads: number;
    staleLeads: number;
    activePercent: number | null;
  };
};

const round = (n: number) => Math.round(n);
const nameOf = (p: any) => p?.user?.fullName || p?.user?.name || "Team lead";

function boardMap(board: BoardEntry[]) {
  return new Map(board.map((e) => [e.partnerId, e]));
}

export async function computeTeamHealth(db: any, now = new Date()): Promise<TeamHealth[]> {
  const current = monthKey(now);
  const last = shiftMonth(current, -1);
  const before = [shiftMonth(current, -2), shiftMonth(current, -3), shiftMonth(current, -4)];

  const teams = await db.salesTeam.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, region: true,
      lead: { select: { id: true, userId: true, agentCode: true, status: true, payoutHoldAt: true, user: { select: { name: true, fullName: true } } } },
      members: { where: { activeKey: { not: null } }, select: { salesPartner: { select: { id: true, status: true, payoutHoldAt: true } } } },
    },
  });
  if (!teams.length) return [];

  const [boardNow, boardLast, ...boardsBefore] = await Promise.all([current, last, ...before].map((m) => computeBoard(m)));
  const nowOf = boardMap(boardNow);
  const lastOf = boardMap(boardLast);
  const beforeOf = boardsBefore.map(boardMap);

  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const allIds = teams.flatMap((t: any) => [t.lead.id, ...t.members.map((m: any) => m.salesPartner.id)]);
  const [opened, open, stale, flagged] = await Promise.all([
    db.salesLead.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: allIds }, createdAt: { gte: since90 } }, _count: { _all: true } }),
    db.salesLead.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: allIds }, status: OPEN_LEAD }, _count: { _all: true } }),
    db.salesLead.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: allIds }, status: OPEN_LEAD, updatedAt: { lt: staleBefore } }, _count: { _all: true } }),
    db.salesLeadVisit.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: allIds }, status: "FLAGGED", reviewedAt: null }, _count: { _all: true } }),
  ]);
  const count = (rows: any[]) => new Map<number, number>(rows.map((r) => [r.salesPartnerId, r._count._all]));
  const openedOf = count(opened);
  const openOf = count(open);
  const staleOf = count(stale);
  const flaggedOf = count(flagged);
  const sum = (ids: number[], m: Map<number, number>) => ids.reduce((s, id) => s + (m.get(id) ?? 0), 0);

  const raw = teams.map((t: any) => {
    const people = [{ id: t.lead.id, status: t.lead.status, payoutHoldAt: t.lead.payoutHoldAt }, ...t.members.map((m: any) => m.salesPartner)];
    const ids = people.map((p: any) => p.id);
    const active = Math.max(1, people.filter((p: any) => p.status === "ACTIVE").length);
    const pts = (m: Map<number, BoardEntry>) => ids.reduce((s: number, id: number) => s + (m.get(id)?.excluded ? 0 : m.get(id)?.points ?? 0), 0);
    const field = (m: Map<number, BoardEntry>, k: "confirmed" | "denials") => ids.reduce((s: number, id: number) => s + Number(m.get(id)?.[k] ?? 0), 0);
    const reversals = (m: Map<number, BoardEntry>) => ids.filter((id: number) => Number(m.get(id)?.reversalPoints ?? 0) > 0).length;

    const perMemberLastMonth = pts(lastOf) / active;
    const beforeAvgs = beforeOf.map((m) => pts(m) / active);
    const hasHistory = beforeAvgs.some((v) => v > 0);
    const perMemberBefore = hasHistory ? beforeAvgs.reduce((a, b) => a + b, 0) / beforeAvgs.length : null;
    const trendPercent = perMemberBefore && perMemberBefore > 0 ? ((perMemberLastMonth - perMemberBefore) / perMemberBefore) * 100 : null;

    const leadsOpened90d = sum(ids, openedOf);
    const confirmed90d = field(nowOf, "confirmed") + field(lastOf, "confirmed") + field(beforeOf[0], "confirmed");
    const conversionPercent = leadsOpened90d >= MIN_LEADS_FOR_CONVERSION ? Math.min(100, (confirmed90d / leadsOpened90d) * 100) : null;

    const denials = field(nowOf, "denials") + field(lastOf, "denials");
    const flaggedVisits = sum(ids, flaggedOf);
    const reversed = reversals(nowOf) + reversals(lastOf);
    const pausedMembers = people.filter((p: any) => p.payoutHoldAt).length;
    const qualityIssues = denials + flaggedVisits + reversed;

    const openLeads = sum(ids, openOf);
    const staleLeads = sum(ids, staleOf);
    const activePercent = openLeads > 0 ? ((openLeads - staleLeads) / openLeads) * 100 : null;

    return {
      t, active, perMemberLastMonth, perMemberBefore, trendPercent, conversionPercent, leadsOpened90d, confirmed90d,
      denials, flaggedVisits, reversed, pausedMembers, qualityIssues, openLeads, staleLeads, activePercent,
      pointsThisMonth: pts(nowOf),
    };
  });

  const bestPerMember = Math.max(1, ...raw.map((r: any) => r.perMemberLastMonth));

  return raw
    .map((r: any): TeamHealth => {
      const qualityRate = r.qualityIssues / r.active;
      const reasons: string[] = [];
      let tip: string | null = null;

      // At risk: signs of cheating or a collapse.
      const atRisk =
        r.pausedMembers > 0 ||
        r.denials >= Math.max(1, Math.ceil(r.active / 3)) ||
        r.flaggedVisits >= 2 ||
        (r.trendPercent !== null && r.trendPercent <= -40);
      if (r.pausedMembers > 0) reasons.push(`${r.pausedMembers} member${r.pausedMembers === 1 ? " has" : "s have"} withdrawals paused for review.`);
      if (r.denials > 0) reasons.push(`${r.denials} owner denial${r.denials === 1 ? "" : "s"} in the last two months.`);
      if (r.flaggedVisits > 0) reasons.push(`${r.flaggedVisits} flagged visit${r.flaggedVisits === 1 ? "" : "s"} waiting for review.`);
      if (r.trendPercent !== null && r.trendPercent <= -20) reasons.push(`Points per member fell ${Math.abs(round(r.trendPercent))}% against the three months before.`);
      if (r.activePercent !== null && r.activePercent < 60) {
        reasons.push(`${r.staleLeads} of ${r.openLeads} open leads have had no activity for ${STALE_DAYS}+ days.`);
        tip ??= `Go through the ${r.staleLeads} stuck leads with your team and move or close them.`;
      }
      if (r.conversionPercent !== null && r.conversionPercent < 10) {
        reasons.push(`Only ${round(r.conversionPercent)}% of leads opened in 90 days became confirmed properties.`);
        tip ??= "Pick the three warmest leads and plan a visit with the owner this week.";
      }
      if (r.flaggedVisits > 0) tip ??= "Ask your team to record visits on site with the property in view.";
      if (r.denials > 0) tip ??= "Make sure each owner knows the partner by name before a property is registered.";

      const needsSupport =
        (r.activePercent !== null && r.activePercent < 60) ||
        (r.conversionPercent !== null && r.conversionPercent < 10) ||
        (r.trendPercent !== null && r.trendPercent <= -20);
      const strong =
        !atRisk && !needsSupport && r.qualityIssues === 0 &&
        r.perMemberLastMonth >= bestPerMember * 0.66 && (r.trendPercent === null || r.trendPercent >= 0) && r.perMemberLastMonth > 0;
      const label: HealthLabel = atRisk ? "AT_RISK" : needsSupport ? "NEEDS_SUPPORT" : strong ? "STRONG" : "STEADY";
      if (label === "STRONG") reasons.unshift("High points per member, clean quality and holding steady.");
      if (label === "STEADY" && !reasons.length) reasons.push("Working steadily with no warning signs.");
      if (label === "STEADY" || label === "STRONG") tip ??= r.conversionPercent !== null && r.conversionPercent < 25 ? "Turn more leads into owner-confirmed properties: follow up within two days of each visit." : null;

      // Score for ordering: output 40, conversion 20, activity 20, quality 20.
      const score = round(
        (r.perMemberLastMonth / bestPerMember) * 40 +
        (r.conversionPercent === null ? 10 : Math.min(1, r.conversionPercent / 30) * 20) +
        (r.activePercent === null ? 10 : (r.activePercent / 100) * 20) +
        Math.max(0, 1 - qualityRate) * 20,
      );

      return {
        teamId: r.t.id,
        name: r.t.name,
        region: r.t.region,
        lead: { partnerId: r.t.lead.id, userId: r.t.lead.userId, name: nameOf(r.t.lead), agentCode: r.t.lead.agentCode },
        members: r.active,
        label,
        score: label === "AT_RISK" ? Math.min(score, 39) : score,
        reasons,
        tip,
        metrics: {
          pointsThisMonth: r.pointsThisMonth,
          perMemberLastMonth: round(r.perMemberLastMonth),
          perMemberBefore: r.perMemberBefore === null ? null : round(r.perMemberBefore),
          trendPercent: r.trendPercent === null ? null : round(r.trendPercent),
          conversionPercent: r.conversionPercent === null ? null : round(r.conversionPercent),
          leadsOpened90d: r.leadsOpened90d,
          confirmed90d: r.confirmed90d,
          qualityIssues: r.qualityIssues,
          pausedMembers: r.pausedMembers,
          openLeads: r.openLeads,
          staleLeads: r.staleLeads,
          activePercent: r.activePercent === null ? null : round(r.activePercent),
        },
      };
    })
    .sort((a: TeamHealth, b: TeamHealth) => b.score - a.score);
}

const NUDGE_ACTION = "SALES_TEAM_HEALTH_NUDGE";
const ALERT_ACTION = "SALES_TEAM_HEALTH_AT_RISK";

/**
 * Weekly, automatic: a lead whose team needs support (or is at risk) gets one
 * concrete tip; admins are alerted once a week when a team is at risk.
 * Recorded in the audit log, which is also what stops repeats.
 */
export async function teamHealthNotices(
  db: any,
  notify: { user: (userId: number, kind: string, data: any) => Promise<unknown>; admins: (kind: string, data: any) => Promise<unknown> },
  now = new Date(),
): Promise<{ nudged: number; alerted: number }> {
  const health = await computeTeamHealth(db, now);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  let nudged = 0;
  let alerted = 0;
  for (const team of health) {
    if (team.label !== "NEEDS_SUPPORT" && team.label !== "AT_RISK") continue;
    const recent = await db.auditLog.findMany({
      where: { entity: "SALES_TEAM", entityId: team.teamId, action: { in: [NUDGE_ACTION, ALERT_ACTION] }, createdAt: { gte: weekAgo } },
      select: { action: true },
    });
    const done = new Set(recent.map((r: any) => r.action));
    if (team.tip && !done.has(NUDGE_ACTION)) {
      await notify.user(team.lead.userId, "sales_partner_team_health_tip", { teamName: team.name, reason: team.reasons[0], tip: team.tip, actionPath: "/sales/team" }).catch(() => undefined);
      await db.auditLog.create({ data: { actorId: null, actorRole: "SYSTEM", action: NUDGE_ACTION, entity: "SALES_TEAM", entityId: team.teamId, afterJson: { label: team.label, tip: team.tip } } });
      nudged++;
    }
    if (team.label === "AT_RISK" && !done.has(ALERT_ACTION)) {
      await notify.admins("sales_team_at_risk", { teamName: team.name, leadName: team.lead.name, reason: team.reasons[0], link: "/admin/sales/teams" }).catch(() => undefined);
      await db.auditLog.create({ data: { actorId: null, actorRole: "SYSTEM", action: ALERT_ACTION, entity: "SALES_TEAM", entityId: team.teamId, afterJson: { reasons: team.reasons } } });
      alerted++;
    }
  }
  return { nudged, alerted };
}
