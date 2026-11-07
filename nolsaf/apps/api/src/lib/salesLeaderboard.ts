/**
 * Sales leaderboard: points from verified results only.
 *
 * Nothing a partner can type counts. Points come from evidence NoLSAF already
 * checks elsewhere:
 *   owner confirmed the property ............ +50  (owner's own "Yes")
 *   a property's first booking (after stay) .. +30  (real money moved)
 *   clean on-site visit ...................... +5   (max 3 per lead)
 *   NoLSAF revenue after check-out ........... +1 per TSh 10,000
 *   owner said "No" / "Don't know them" ...... -40
 *   commission reversed (refund, self-deal) .. revenue points removed
 *
 * Boards are computed on the server from those tables and cached for a minute,
 * so however often the page is opened (or a script hits the endpoint), the
 * database does the work at most once a minute per month.
 *
 * Months are calendar months in EAT, keyed "YYYY-MM".
 */
import { prisma } from "@nolsaf/prisma";

const db = prisma as any;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const POINTS = {
  confirmedProperty: 50,
  liveProperty: 30,
  verifiedVisit: 5,
  maxVisitsPerLead: 3,
  revenueStep: 10_000,
  ownerDenial: -40,
} as const;

export const DEFAULT_MONTHLY_TARGET = 5;
export const TARGET_MIN = 1;
export const TARGET_MAX = 50;

// ---- months (EAT) -----------------------------------------------------------

export function monthKey(at = new Date()): string {
  const eat = new Date(at.getTime() + EAT_OFFSET_MS);
  return `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - EAT_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - EAT_OFFSET_MS),
  };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The months of the quarter containing `key`, up to and including `key`. */
export function quarterMonths(key: string): string[] {
  const [y, m] = key.split("-").map(Number);
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  const out: string[] = [];
  for (let month = first; month <= m; month += 1) out.push(`${y}-${String(month).padStart(2, "0")}`);
  return out;
}

// ---- scoring ----------------------------------------------------------------

export type Breakdown = {
  confirmed: number;
  live: number;
  visits: number;
  flaggedVisits: number;
  revenuePoints: number;
  denials: number;
  reversalPoints: number;
};

export type BoardEntry = Breakdown & {
  partnerId: number;
  name: string;
  publicName: string;
  region: string | null;
  level: string;
  teamId: number | null;
  points: number;
  rank: number;
  excluded: boolean;
};

export function pointsFor(b: Breakdown): number {
  return (
    b.confirmed * POINTS.confirmedProperty +
    b.live * POINTS.liveProperty +
    b.visits * POINTS.verifiedVisit +
    b.revenuePoints +
    b.denials * POINTS.ownerDenial -
    b.reversalPoints
  );
}

/** "Amina Mussa Juma" -> "Amina J." Names on the shared board are never full. */
export function publicName(full: string): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Representative";
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  return parts.length > 1 ? `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : first;
}

/** Competition ranking (1, 2, 2, 4) on points, then confirmed properties, then visits. */
export function rankEntries<T extends { points: number; confirmed: number; visits: number; partnerId: number; excluded?: boolean }>(entries: T[]): Array<T & { rank: number }> {
  const sorted = entries
    .filter((e) => !e.excluded)
    .sort((a, b) => b.points - a.points || b.confirmed - a.confirmed || b.visits - a.visits || a.partnerId - b.partnerId);
  let rank = 0;
  let prev: T | null = null;
  return sorted.map((entry, index) => {
    if (!prev || prev.points !== entry.points || prev.confirmed !== entry.confirmed || prev.visits !== entry.visits) rank = index + 1;
    prev = entry;
    return { ...entry, rank };
  });
}

const emptyBreakdown = (): Breakdown => ({ confirmed: 0, live: 0, visits: 0, flaggedVisits: 0, revenuePoints: 0, denials: 0, reversalPoints: 0 });
const REVENUE_TYPES = ["NRMS_USAGE", "MARKETPLACE_BOOKING"];
const EARNED_STATUSES = ["ELIGIBLE", "APPROVED", "AVAILABLE", "PAID"];

/** Every active partner's breakdown for [start, end). */
async function breakdowns(start: Date, end: Date): Promise<Map<number, Breakdown>> {
  const range = { gte: start, lt: end };
  const [confirmations, firstBookings, visits, flagged, revenue, reversals] = await Promise.all([
    db.salesOwnerConfirmation.findMany({
      where: { status: { in: ["CONFIRMED", "DENIED", "UNKNOWN_PARTNER"] }, respondedAt: range },
      select: { salesPartnerId: true, propertyId: true, status: true },
    }),
    db.salesCommission.groupBy({
      by: ["salesPartnerId", "propertyId"],
      where: { type: "MARKETPLACE_BOOKING", status: { notIn: ["REVERSED", "CANCELLED"] }, reversalOfId: null, propertyId: { not: null } },
      _min: { earnedAt: true },
    }),
    db.salesLeadVisit.findMany({ where: { status: "VERIFIED", receivedAt: range }, select: { salesPartnerId: true, leadId: true } }),
    db.salesLeadVisit.groupBy({ by: ["salesPartnerId"], where: { status: "FLAGGED", receivedAt: range }, _count: { _all: true } }),
    db.salesCommission.findMany({
      where: { type: { in: REVENUE_TYPES }, status: { in: EARNED_STATUSES }, currency: "TZS", eligibleAt: range },
      select: { salesPartnerId: true, eligibleNetRevenue: true },
    }),
    db.salesCommission.findMany({
      where: { type: { in: REVENUE_TYPES }, status: "REVERSED", currency: "TZS", reversedAt: range, eligibleAt: { not: null } },
      select: { salesPartnerId: true, eligibleNetRevenue: true, eligibleAt: true },
    }),
  ]);

  const map = new Map<number, Breakdown>();
  const get = (id: number) => {
    let b = map.get(id);
    if (!b) map.set(id, (b = emptyBreakdown()));
    return b;
  };

  const seen = new Set<string>();
  for (const row of confirmations) {
    const key = `${row.salesPartnerId}:${row.propertyId}:${row.status === "CONFIRMED" ? "Y" : "N"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.status === "CONFIRMED") get(row.salesPartnerId).confirmed += 1;
    else get(row.salesPartnerId).denials += 1;
  }
  for (const row of firstBookings) {
    const first = row._min?.earnedAt ? new Date(row._min.earnedAt) : null;
    if (first && first >= start && first < end) get(row.salesPartnerId).live += 1;
  }
  const perLead = new Map<string, number>();
  for (const row of visits) {
    const key = `${row.salesPartnerId}:${row.leadId}`;
    const n = (perLead.get(key) ?? 0) + 1;
    perLead.set(key, n);
    if (n <= POINTS.maxVisitsPerLead) get(row.salesPartnerId).visits += 1;
  }
  for (const row of flagged) get(row.salesPartnerId).flaggedVisits += row._count._all;

  const revenueSum = new Map<number, number>();
  for (const row of revenue) revenueSum.set(row.salesPartnerId, (revenueSum.get(row.salesPartnerId) ?? 0) + Number(row.eligibleNetRevenue || 0));
  for (const [id, sum] of revenueSum) get(id).revenuePoints = Math.floor(sum / POINTS.revenueStep);
  // A reversal only takes back points the revenue actually earned (it had become eligible).
  const reversedSum = new Map<number, number>();
  for (const row of reversals) reversedSum.set(row.salesPartnerId, (reversedSum.get(row.salesPartnerId) ?? 0) + Math.max(0, Number(row.eligibleNetRevenue || 0)));
  for (const [id, sum] of reversedSum) get(id).reversalPoints = Math.floor(sum / POINTS.revenueStep);
  return map;
}

type CacheEntry = { at: number; entries: BoardEntry[] };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 60_000;

/** Ranked board for a month, optionally as it stood at `asOf` (for "rank this week" movement). */
export async function computeBoard(month: string, asOf?: Date): Promise<BoardEntry[]> {
  const { start, end } = monthRange(month);
  const cutoff = asOf && asOf < end ? new Date(Math.floor(asOf.getTime() / 3_600_000) * 3_600_000) : end;
  const key = `${month}|${cutoff.getTime()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.entries;

  const [partners, exclusions, scores] = await Promise.all([
    db.salesPartnerProfile.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        region: true,
        level: true,
        user: { select: { name: true, fullName: true } },
        teamMemberships: { where: { activeKey: { not: null } }, select: { teamId: true }, take: 1 },
        ledTeam: { select: { id: true, status: true } },
      },
    }),
    db.salesPartnerMonth.findMany({ where: { month, excludedAt: { not: null } }, select: { salesPartnerId: true } }),
    breakdowns(start, cutoff),
  ]);
  const excluded = new Set(exclusions.map((row: any) => row.salesPartnerId));

  const entries = rankEntries(
    partners.map((p: any) => {
      const b = scores.get(p.id) ?? emptyBreakdown();
      const name = p.user?.fullName || p.user?.name || "Representative";
      const teamId = p.ledTeam?.status === "ACTIVE" ? p.ledTeam.id : p.teamMemberships?.[0]?.teamId ?? null;
      return { ...b, partnerId: p.id, name, publicName: publicName(name), region: p.region ?? null, level: p.level || "STARTER", teamId, points: pointsFor(b), excluded: excluded.has(p.id) };
    }),
  ) as BoardEntry[];

  cache.set(key, { at: Date.now(), entries });
  if (cache.size > 50) {
    for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  }
  return entries;
}

export function clearBoardCache(): void {
  cache.clear();
}

/** Sum of points over months: closed months from their frozen result, the current one live. */
export async function aggregateBoard(months: string[], current: string): Promise<Array<{ partnerId: number; points: number; confirmed: number; visits: number }>> {
  const totals = new Map<number, { points: number; confirmed: number; visits: number }>();
  const closed = months.filter((m) => m !== current);
  if (closed.length) {
    const rows = await db.salesPartnerMonth.findMany({
      where: { month: { in: closed }, closedAt: { not: null }, excludedAt: null },
      select: { salesPartnerId: true, finalPoints: true, finalBreakdown: true },
    });
    for (const row of rows) {
      const t = totals.get(row.salesPartnerId) ?? { points: 0, confirmed: 0, visits: 0 };
      t.points += Number(row.finalPoints || 0);
      t.confirmed += Number((row.finalBreakdown as any)?.confirmed || 0);
      t.visits += Number((row.finalBreakdown as any)?.visits || 0);
      totals.set(row.salesPartnerId, t);
    }
  }
  if (months.includes(current)) {
    for (const e of await computeBoard(current)) {
      const t = totals.get(e.partnerId) ?? { points: 0, confirmed: 0, visits: 0 };
      t.points += e.points;
      t.confirmed += e.confirmed;
      t.visits += e.visits;
      totals.set(e.partnerId, t);
    }
  }
  return [...totals.entries()].map(([partnerId, t]) => ({ partnerId, ...t }));
}

export async function targetFor(partnerId: number, month: string): Promise<number> {
  const row = await db.salesPartnerMonth.findUnique({ where: { salesPartnerId_month: { salesPartnerId: partnerId, month } }, select: { target: true } });
  return row?.target ?? DEFAULT_MONTHLY_TARGET;
}

// ---- month close and nudges (run by the sales worker) ------------------------

export type Badge = "TOP_1" | "TOP_2" | "TOP_3" | "RISING_STAR" | "MOST_TRUSTED";

export function badgesFor(entry: { rank: number; points: number; confirmed: number; denials: number; flaggedVisits: number }, risingStarId: number | null, partnerId: number): Badge[] {
  const badges: Badge[] = [];
  if (entry.points > 0 && entry.rank <= 3) badges.push((["TOP_1", "TOP_2", "TOP_3"] as const)[entry.rank - 1]);
  if (risingStarId === partnerId) badges.push("RISING_STAR");
  if (entry.confirmed >= 1 && entry.denials === 0 && entry.flaggedVisits === 0) badges.push("MOST_TRUSTED");
  return badges;
}

/**
 * Freeze last month's results. Safe with several API instances running: each
 * partner's row is claimed with a conditional update, so a result is written,
 * and its notice sent, once.
 */
export async function closeMonth(month: string, notify: (userId: number, template: string, data: any) => Promise<unknown>): Promise<number> {
  const already = await db.salesPartnerMonth.count({ where: { month, closedAt: { not: null } } });
  const board = await computeBoard(month);
  if (already && already >= board.length) return 0;

  const previous = await db.salesPartnerMonth.findMany({ where: { month: shiftMonth(month, -1), finalRank: { not: null } }, select: { salesPartnerId: true, finalRank: true } });
  const prevRank = new Map<number, number>(previous.map((row: any) => [row.salesPartnerId, row.finalRank]));
  let risingStarId: number | null = null;
  let bestClimb = 0;
  for (const e of board) {
    const before = prevRank.get(e.partnerId);
    if (before && e.points > 0 && before - e.rank > bestClimb) {
      bestClimb = before - e.rank;
      risingStarId = e.partnerId;
    }
  }
  const users = await db.salesPartnerProfile.findMany({ where: { id: { in: board.map((e) => e.partnerId) } }, select: { id: true, userId: true } });
  const userOf = new Map<number, number>(users.map((u: any) => [u.id, u.userId]));

  let closed = 0;
  const now = new Date();
  for (const e of board) {
    const badges = badgesFor(e, risingStarId, e.partnerId);
    const breakdown = { confirmed: e.confirmed, live: e.live, visits: e.visits, flaggedVisits: e.flaggedVisits, revenuePoints: e.revenuePoints, denials: e.denials, reversalPoints: e.reversalPoints };
    await db.salesPartnerMonth.upsert({
      where: { salesPartnerId_month: { salesPartnerId: e.partnerId, month } },
      create: { salesPartnerId: e.partnerId, month },
      update: {},
    });
    const claimed = await db.salesPartnerMonth.updateMany({
      where: { salesPartnerId: e.partnerId, month, closedAt: null },
      data: { finalRank: e.rank, finalPoints: e.points, finalBreakdown: breakdown, badges, closedAt: now },
    });
    if (claimed.count !== 1) continue;
    closed += 1;
    const userId = userOf.get(e.partnerId);
    if (userId) await notify(userId, "sales_partner_month_results", { month, rank: e.rank, points: e.points, badges, total: board.length }).catch(() => undefined);
  }
  return closed;
}

/**
 * Hourly: record live ranks, congratulate new top-3 entrants once a month, and
 * on Mondays tell each representative how far they are from the next place.
 */
export async function liveRankNotices(notify: (userId: number, template: string, data: any) => Promise<unknown>, now = new Date()): Promise<{ topThree: number; nudged: number }> {
  const month = monthKey(now);
  const board = await computeBoard(month);
  const users = await db.salesPartnerProfile.findMany({ where: { id: { in: board.map((e) => e.partnerId) } }, select: { id: true, userId: true } });
  const userOf = new Map<number, number>(users.map((u: any) => [u.id, u.userId]));
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const mondayMorning = eat.getUTCDay() === 1 && eat.getUTCHours() >= 8 && eat.getUTCHours() < 20;
  let topThree = 0;
  let nudged = 0;

  for (const e of board) {
    await db.salesPartnerMonth.upsert({
      where: { salesPartnerId_month: { salesPartnerId: e.partnerId, month } },
      create: { salesPartnerId: e.partnerId, month, liveRank: e.rank, liveRankAt: now },
      update: { liveRank: e.rank, liveRankAt: now },
    });
    const userId = userOf.get(e.partnerId);
    if (!userId) continue;
    if (e.rank <= 3 && e.points > 0) {
      const claim = await db.salesPartnerMonth.updateMany({ where: { salesPartnerId: e.partnerId, month, topThreeNotifiedAt: null }, data: { topThreeNotifiedAt: now } });
      if (claim.count === 1) {
        topThree += 1;
        await notify(userId, "sales_partner_top_three", { rank: e.rank, points: e.points }).catch(() => undefined);
      }
    }
    if (mondayMorning && e.rank > 1) {
      const ahead = board.filter((other) => other.rank < e.rank).pop();
      if (!ahead) continue;
      const claim = await db.salesPartnerMonth.updateMany({
        where: { salesPartnerId: e.partnerId, month, OR: [{ nudgedAt: null }, { nudgedAt: { lt: new Date(now.getTime() - 6 * DAY_MS) } }] },
        data: { nudgedAt: now },
      });
      if (claim.count === 1) {
        nudged += 1;
        await notify(userId, "sales_partner_rank_nudge", { gap: ahead.points - e.points + 1, nextRank: ahead.rank, rank: e.rank }).catch(() => undefined);
      }
    }
  }
  return { topThree, nudged };
}

/**
 * The winning team of a finished month: the most points among teams that are
 * still active, from that month's board. Null when no team scored. Used for
 * the "Top team" badge only; it carries no money.
 */
export async function topTeamOfMonth(month: string): Promise<{ teamId: number; name: string; points: number; month: string } | null> {
  const board = await computeBoard(month);
  const totals = new Map<number, number>();
  for (const e of board) if (e.teamId != null && !e.excluded) totals.set(e.teamId, (totals.get(e.teamId) ?? 0) + e.points);
  const ranked = [...totals.entries()].filter(([, points]) => points > 0).sort((a, b) => b[1] - a[1]);
  // A team with fraud signals cannot win: a paused member or a flagged visit
  // still waiting for review. The next clean team takes the badge.
  for (let i = 0; i < ranked.length; i++) {
    const [teamId, points] = ranked[i];
    const team = await db.salesTeam.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, status: true, leadPartnerId: true, members: { where: { activeKey: { not: null } }, select: { salesPartnerId: true } } },
    });
    if (!team || team.status !== "ACTIVE") continue;
    const ids = [team.leadPartnerId, ...team.members.map((m: any) => m.salesPartnerId)];
    const [paused, flagged] = await Promise.all([
      db.salesPartnerProfile.count({ where: { id: { in: ids }, payoutHoldAt: { not: null } } }),
      db.salesLeadVisit.count({ where: { salesPartnerId: { in: ids }, status: "FLAGGED", reviewedAt: null } }),
    ]);
    if (paused || flagged) continue;
    // A tie with the next clean team has no single winner, so no badge.
    if (ranked[i + 1] && ranked[i + 1][1] === points) return null;
    return { teamId: team.id, name: team.name, points, month };
  }
  return null;
}
