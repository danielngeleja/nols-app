/**
 * Monthly targets: suggested from the partner's own record, confirmed by an
 * admin in one click, and protected by two fairness rules.
 *
 *   suggested  3-month average of confirmed properties + 20%, rounded,
 *              between 1 and 50; a partner with no history starts at 3
 *   keep       the current target
 *   stretch    suggested + 2
 *
 *   1. No raising mid-month: after the 10th (EAT) a higher target only
 *      applies from next month. Lowering is always allowed.
 *   2. The admin's target wins: a team lead may move it by at most 2.
 */
import { computeBoard, DEFAULT_MONTHLY_TARGET, monthKey, shiftMonth, TARGET_MAX, TARGET_MIN } from "./salesLeaderboard.js";

export const RAISE_CUTOFF_DAY = 10;
export const LEAD_RANGE = 2;
export const NEW_PARTNER_TARGET = 3;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export type TargetChoice = "SUGGESTED" | "KEEP" | "STRETCH" | "CUSTOM";

export class TargetRuleError extends Error {
  constructor(message: string, readonly code = "TARGET_RULE") {
    super(message);
  }
}

const clamp = (n: number) => Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.round(n)));

export function eatDayOfMonth(now = new Date()): number {
  return new Date(now.getTime() + EAT_OFFSET_MS).getUTCDate();
}

export function daysLeftInMonth(now = new Date()): number {
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const last = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + 1, 0)).getUTCDate();
  return last - eat.getUTCDate();
}

/** history: confirmed properties in each of the last finished months. */
export function suggestTargets(history: number[], current: number) {
  const known = history.filter((n) => Number.isFinite(n));
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const suggested = avg > 0 ? clamp(Math.max(Math.ceil(avg), avg * 1.2)) : NEW_PARTNER_TARGET;
  return { average: Math.round(avg * 10) / 10, suggested, keep: clamp(current), stretch: clamp(suggested + 2) };
}

/** The value a preset choice stands for, or null for CUSTOM. */
export function presetValue(choice: TargetChoice, s: ReturnType<typeof suggestTargets>): number | null {
  return choice === "SUGGESTED" ? s.suggested : choice === "KEEP" ? s.keep : choice === "STRETCH" ? s.stretch : null;
}

/** Rule 1. Throws when a raise lands in the current month after the cutoff. */
export function assertNoLateRaise(input: { month: string; current: number; next: number; now?: Date }) {
  const now = input.now ?? new Date();
  if (input.month === monthKey(now) && input.next > input.current && eatDayOfMonth(now) > RAISE_CUTOFF_DAY) {
    throw new TargetRuleError(`After the ${RAISE_CUTOFF_DAY}th a higher target only applies from next month. Lowering it is fine.`, "LATE_RAISE");
  }
}

/** The target an admin last set for this partner and month, or null. */
export async function adminTargetFor(db: any, partnerId: number, month: string): Promise<number | null> {
  const rows = await db.auditLog.findMany({
    where: { entity: "SALES_PARTNER", entityId: partnerId, action: { in: ["SALES_TARGET_SET", "SALES_TARGET_BULK_SET"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { afterJson: true },
  });
  for (const row of rows) {
    const j = (row.afterJson || {}) as any;
    if (j.month === month && Number.isFinite(Number(j.target))) return Number(j.target);
  }
  return null;
}

/** Rule 2. Throws when a team lead moves an admin-set target by more than LEAD_RANGE. */
export function assertWithinLeadRange(adminTarget: number | null, next: number) {
  if (adminTarget === null) return;
  if (Math.abs(next - adminTarget) > LEAD_RANGE) {
    throw new TargetRuleError(
      `NoLSAF set this month's target at ${adminTarget}. You can move it to between ${Math.max(TARGET_MIN, adminTarget - LEAD_RANGE)} and ${Math.min(TARGET_MAX, adminTarget + LEAD_RANGE)}.`,
      "LEAD_RANGE",
    );
  }
}

type Boards = { finished: string[]; byMonth: Map<string, Map<number, any>> };

async function loadBoards(now: Date): Promise<Boards & { current: string }> {
  const current = monthKey(now);
  const finished = [shiftMonth(current, -1), shiftMonth(current, -2), shiftMonth(current, -3)];
  const boards = await Promise.all([current, ...finished].map((m) => computeBoard(m)));
  const byMonth = new Map<string, Map<number, any>>();
  [current, ...finished].forEach((m, i) => byMonth.set(m, new Map(boards[i].map((e: any) => [e.partnerId, e]))));
  return { current, finished, byMonth };
}

function historyOf(b: Boards, partnerId: number): number[] {
  return b.finished.map((m) => Number(b.byMonth.get(m)?.get(partnerId)?.confirmed ?? 0));
}

const avgOf = (rows: number[][]) => {
  const all = rows.map((h) => h.reduce((a, c) => a + c, 0) / Math.max(1, h.length));
  return all.length ? Math.round((all.reduce((a, c) => a + c, 0) / all.length) * 10) / 10 : null;
};

/** Everything the admin needs beside the target box. */
export async function targetContext(db: any, partnerId: number, now = new Date()) {
  const b = await loadBoards(now);
  const nextMonth = shiftMonth(b.current, 1);
  const [partner, rows, membership, led] = await Promise.all([
    db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { id: true, region: true, status: true, activatedAt: true } }),
    db.salesPartnerMonth.findMany({ where: { salesPartnerId: partnerId, month: { in: [b.current, nextMonth] } }, select: { month: true, target: true, targetSetByRole: true } }),
    db.salesTeamMember.findUnique({ where: { activeKey: partnerId }, select: { teamId: true } }),
    db.salesTeam.findUnique({ where: { leadPartnerId: partnerId }, select: { id: true, status: true } }),
  ]);
  if (!partner) return null;
  const rowOf = (m: string) => rows.find((r: any) => r.month === m);
  const currentTarget = rowOf(b.current)?.target ?? DEFAULT_MONTHLY_TARGET;
  const history = historyOf(b, partnerId);

  const teamId = led?.status === "ACTIVE" ? led.id : membership?.teamId ?? null;
  const teamIds = teamId
    ? [...(await db.salesTeamMember.findMany({ where: { teamId, activeKey: { not: null } }, select: { salesPartnerId: true } })).map((m: any) => m.salesPartnerId),
       ...(await db.salesTeam.findMany({ where: { id: teamId }, select: { leadPartnerId: true } })).map((t: any) => t.leadPartnerId)]
    : [];
  const regionIds = partner.region
    ? [...(b.byMonth.get(b.finished[0])?.values() ?? [])].filter((e: any) => e.region === partner.region).map((e: any) => e.partnerId)
    : [];

  const s = suggestTargets(history, currentTarget);
  return {
    month: b.current,
    nextMonth,
    finishedMonths: b.finished,
    history,
    thisMonth: { confirmed: Number(b.byMonth.get(b.current)?.get(partnerId)?.confirmed ?? 0), target: currentTarget, setBy: rowOf(b.current)?.targetSetByRole ?? "DEFAULT", daysLeft: daysLeftInMonth(now) },
    nextMonthTarget: rowOf(nextMonth) ? { target: rowOf(nextMonth)!.target, setBy: rowOf(nextMonth)!.targetSetByRole } : null,
    teamAverage: teamIds.length > 1 ? avgOf(teamIds.filter((id: number) => id !== partnerId).map((id: number) => historyOf(b, id))) : null,
    regionAverage: regionIds.length > 1 ? avgOf(regionIds.filter((id: number) => id !== partnerId).map((id: number) => historyOf(b, id))) : null,
    choices: s,
    rules: { raiseCutoffDay: RAISE_CUTOFF_DAY, raiseAllowedThisMonth: eatDayOfMonth(now) <= RAISE_CUTOFF_DAY, min: TARGET_MIN, max: TARGET_MAX },
  };
}

/** Next month's suggested targets for every active partner, for one-click approval. */
export async function nextMonthSuggestions(db: any, now = new Date()) {
  const b = await loadBoards(now);
  // From next month's point of view, this month is the most recent one.
  const recent = [b.current, ...b.finished.slice(0, 2)];
  const nextMonth = shiftMonth(b.current, 1);
  const partners = await db.salesPartnerProfile.findMany({
    where: { status: "ACTIVE" },
    orderBy: { agentCode: "asc" },
    take: 1000,
    select: {
      id: true, agentCode: true, region: true,
      user: { select: { name: true, fullName: true } },
      teamMemberships: { where: { activeKey: { not: null } }, select: { team: { select: { name: true } } }, take: 1 },
      ledTeam: { select: { name: true, status: true } },
    },
  });
  const set = await db.salesPartnerMonth.findMany({ where: { month: nextMonth, salesPartnerId: { in: partners.map((p: any) => p.id) } }, select: { salesPartnerId: true, target: true, targetSetByRole: true } });
  const setOf = new Map<number, any>(set.map((r: any) => [r.salesPartnerId, r]));
  return {
    month: nextMonth,
    basedOn: recent,
    partners: partners.map((p: any) => {
      const history = recent.map((m) => Number(b.byMonth.get(m)?.get(p.id)?.confirmed ?? 0));
      const existing = setOf.get(p.id);
      const s = suggestTargets(history, existing?.target ?? DEFAULT_MONTHLY_TARGET);
      return {
        partnerId: p.id,
        name: p.user?.fullName || p.user?.name || "Partner",
        agentCode: p.agentCode,
        region: p.region,
        team: p.ledTeam?.status === "ACTIVE" ? `${p.ledTeam.name} (lead)` : p.teamMemberships?.[0]?.team?.name ?? null,
        history,
        suggested: s.suggested,
        current: existing ? { target: existing.target, setBy: existing.targetSetByRole } : null,
      };
    }),
  };
}
