import { beforeEach, describe, expect, it, vi } from "vitest";

const boards = vi.hoisted(() => ({ byMonth: new Map<string, any[]>() }));
vi.mock("../lib/salesLeaderboard.js", () => ({
  monthKey: () => "2026-11",
  shiftMonth: (key: string, delta: number) => {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  },
  computeBoard: async (month: string) => boards.byMonth.get(month) ?? [],
}));

import { computeTeamHealth, teamHealthNotices } from "../lib/salesTeamHealth.js";

const entry = (partnerId: number, points: number, extra: any = {}) => ({ partnerId, points, confirmed: 0, denials: 0, reversalPoints: 0, excluded: false, ...extra });
const team = (id: number, name: string, leadId: number, memberIds: number[], held: number[] = []) => ({
  id, name, region: "Arusha",
  lead: { id: leadId, userId: leadId + 100, agentCode: `SP-${leadId}`, status: "ACTIVE", payoutHoldAt: held.includes(leadId) ? new Date() : null, user: { name: `Lead ${leadId}` } },
  members: memberIds.map((pid) => ({ salesPartner: { id: pid, status: "ACTIVE", payoutHoldAt: held.includes(pid) ? new Date() : null } })),
});

function makeDb(teams: any[], groups: Partial<Record<"opened" | "open" | "stale" | "flagged", Array<[number, number]>>> = {}) {
  const rows = (pairs: Array<[number, number]> = []) => pairs.map(([salesPartnerId, n]) => ({ salesPartnerId, _count: { _all: n } }));
  return {
    salesTeam: { findMany: vi.fn().mockResolvedValue(teams) },
    salesLead: {
      groupBy: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.createdAt ? rows(groups.opened) : where.updatedAt ? rows(groups.stale) : rows(groups.open))),
    },
    salesLeadVisit: { groupBy: vi.fn().mockResolvedValue(rows(groups.flagged)) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => boards.byMonth.clear());

describe("computeTeamHealth", () => {
  it("ranks a small excellent team above a big average one (points per member, not totals)", async () => {
    // Last month (2026-10): small team 3 x 300 = 900; big team 10 x 120 = 1200.
    boards.byMonth.set("2026-10", [1, 2, 3].map((id) => entry(id, 300)).concat([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((id) => entry(id, 120))));
    const db = makeDb([team(1, "Small", 1, [2, 3]), team(2, "Big", 10, [11, 12, 13, 14, 15, 16, 17, 18, 19])]);
    const health = await computeTeamHealth(db, new Date("2026-11-08T09:00:00Z"));
    expect(health[0].name).toBe("Small");
    expect(health[0].metrics.perMemberLastMonth).toBe(300);
    expect(health[1].metrics.perMemberLastMonth).toBe(120);
  });

  it("marks a team at risk when a member's withdrawals are paused, and names it first", async () => {
    boards.byMonth.set("2026-10", [entry(1, 400), entry(2, 400)]);
    const db = makeDb([team(1, "Arusha North", 1, [2], [2])]);
    const [h] = await computeTeamHealth(db, new Date("2026-11-08T09:00:00Z"));
    expect(h.label).toBe("AT_RISK");
    expect(h.reasons[0]).toMatch(/withdrawals paused/);
    expect(h.score).toBeLessThan(40);
  });

  it("needs support when most open leads are stuck, with a concrete tip", async () => {
    boards.byMonth.set("2026-10", [entry(1, 100), entry(2, 100)]);
    const db = makeDb([team(1, "Coast", 1, [2])], { open: [[1, 5], [2, 5]], stale: [[1, 4], [2, 4]] });
    const [h] = await computeTeamHealth(db, new Date("2026-11-08T09:00:00Z"));
    expect(h.label).toBe("NEEDS_SUPPORT");
    expect(h.metrics.activePercent).toBe(20);
    expect(h.tip).toMatch(/8 stuck leads/);
  });

  it("does not judge conversion on fewer than five leads", async () => {
    boards.byMonth.set("2026-10", [entry(1, 200)]);
    const db = makeDb([team(1, "Mwanza", 1, [])], { opened: [[1, 3]] });
    const [h] = await computeTeamHealth(db, new Date("2026-11-08T09:00:00Z"));
    expect(h.metrics.conversionPercent).toBeNull();
  });

  it("calls a falling team out and a clean leading team strong", async () => {
    boards.byMonth.set("2026-10", [entry(1, 300), entry(2, 300), entry(3, 50), entry(4, 50)]);
    for (const m of ["2026-09", "2026-08", "2026-07"]) boards.byMonth.set(m, [entry(1, 280), entry(2, 280), entry(3, 200), entry(4, 200)]);
    const db = makeDb([team(1, "Rising", 1, [2]), team(2, "Falling", 3, [4])]);
    const health = await computeTeamHealth(db, new Date("2026-11-08T09:00:00Z"));
    const rising = health.find((t) => t.name === "Rising")!;
    const falling = health.find((t) => t.name === "Falling")!;
    expect(rising.label).toBe("STRONG");
    expect(falling.label).toBe("AT_RISK");
    expect(falling.metrics.trendPercent).toBe(-75);
  });
});

describe("teamHealthNotices", () => {
  it("sends one tip and one admin alert per team per week", async () => {
    boards.byMonth.set("2026-10", [entry(1, 400), entry(2, 400)]);
    const db = makeDb([team(1, "Arusha North", 1, [2], [2])], { open: [[1, 4]], stale: [[1, 4]] });
    const user = vi.fn().mockResolvedValue(undefined);
    const admins = vi.fn().mockResolvedValue(undefined);
    expect(await teamHealthNotices(db, { user, admins }, new Date("2026-11-08T09:00:00Z"))).toEqual({ nudged: 1, alerted: 1 });
    db.auditLog.findMany.mockResolvedValue([{ action: "SALES_TEAM_HEALTH_NUDGE" }, { action: "SALES_TEAM_HEALTH_AT_RISK" }]);
    expect(await teamHealthNotices(db, { user, admins }, new Date("2026-11-09T09:00:00Z"))).toEqual({ nudged: 0, alerted: 0 });
    expect(user).toHaveBeenCalledTimes(1);
    expect(admins).toHaveBeenCalledWith("sales_team_at_risk", expect.objectContaining({ teamName: "Arusha North" }));
  });
});
