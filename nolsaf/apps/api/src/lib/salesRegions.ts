/**
 * Sales regions and regional leads (docs/SALES_REGIONS.md).
 *
 * A partner belongs to a region through SalesPartnerProfile.regionId. A region
 * may have one Regional lead (an active partner). The lead sees the region's
 * teams and partners, earns an override on their commissions (never on their
 * own), and may recommend, never approve, money decisions.
 */
import { COMMISSION_TRANSACTION_OPTIONS } from "./nrmsTransaction.js";
import { computeBoard, DEFAULT_MONTHLY_TARGET, monthKey, monthRange } from "./salesLeaderboard.js";
import { isContractEarning } from "./salesPartner.js";
import { autoReverseSalesCommission, roundSalesMoney } from "./salesCommission.js";
import { computeTeamHealth } from "./salesTeamHealth.js";

export class RegionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Commission types a regional override is paid on: revenue the partner brought. */
export const OVERRIDE_BASE_TYPES = ["NRMS_USAGE", "MARKETPLACE_BOOKING", "AGENCY_STAY", "AGENCY_GROUP", "AGENCY_TOUR", "LONG_STAY_TENANCY"];
const CLOSED = ["REVERSED", "CANCELLED"];
const WITHDRAWABLE = ["ELIGIBLE", "APPROVED", "AVAILABLE", "PAID"];
const DAY_MS = 86_400_000;

export function overrideSourceKey(baseCommissionId: number) {
  return `REGION_OVERRIDE:${baseCommissionId}`;
}

// ---------- mapping the old free-text region ----------

function areasOf(region: { areas: unknown }): string[] {
  return Array.isArray(region.areas) ? region.areas.map((a) => String(a).toLowerCase()) : [];
}

/** The region whose areas match a free-text place, or null. Exact words only. */
export function matchRegionId(text: string | null | undefined, regions: Array<{ id: number; areas: unknown }>): number | null {
  const value = String(text || "").toLowerCase().replace(/\bregion\b/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  const padded = ` ${value} `;
  const hits = regions.filter((r) => areasOf(r).some((area) => padded.includes(` ${area} `)));
  return hits.length === 1 ? hits[0].id : null;
}

/** Fills regionId for partners and teams that have none, from their own text, then their team's. */
export async function autoAssignRegions(db: any) {
  const regions = await db.salesRegion.findMany({ where: { status: "ACTIVE" }, select: { id: true, areas: true } });
  const teams = await db.salesTeam.findMany({ where: { regionId: null }, select: { id: true, region: true } });
  let teamsAssigned = 0;
  for (const team of teams) {
    const id = matchRegionId(team.region, regions);
    if (!id) continue;
    teamsAssigned += (await db.salesTeam.updateMany({ where: { id: team.id, regionId: null }, data: { regionId: id } })).count;
  }
  const partners = await db.salesPartnerProfile.findMany({
    where: { regionId: null },
    select: { id: true, region: true, teamMemberships: { where: { activeKey: { not: null } }, select: { team: { select: { regionId: true } } }, take: 1 }, ledTeam: { select: { regionId: true } } },
  });
  let partnersAssigned = 0;
  for (const p of partners) {
    const id = matchRegionId(p.region, regions) ?? p.ledTeam?.regionId ?? p.teamMemberships?.[0]?.team?.regionId ?? null;
    if (!id) continue;
    partnersAssigned += (await db.salesPartnerProfile.updateMany({ where: { id: p.id, regionId: null }, data: { regionId: id } })).count;
  }
  const [partnersLeft, teamsLeft] = await Promise.all([
    db.salesPartnerProfile.count({ where: { regionId: null, status: { in: ["ACTIVE", "PENDING"] } } }),
    db.salesTeam.count({ where: { regionId: null, status: "ACTIVE" } }),
  ]);
  return { partnersAssigned, teamsAssigned, partnersLeft, teamsLeft };
}

// ---------- the lead ----------

export async function regionLedBy(db: any, partnerId: number) {
  if (!partnerId) return null;
  return db.salesRegion.findFirst({ where: { leadPartnerId: partnerId, status: "ACTIVE" } }).catch((error: any) => {
    if (error?.code === "P2021" || error?.code === "P2022") return null; // not migrated yet
    throw error;
  });
}

/** The lead to tell about a partner of a region, other than the partner themself. */
export async function regionLeadUserFor(db: any, salesPartnerId: number): Promise<{ userId: number; regionName: string } | null> {
  try {
    const partner = await db.salesPartnerProfile.findUnique({ where: { id: salesPartnerId }, select: { regionId: true } });
    if (!partner?.regionId) return null;
    const region = await db.salesRegion.findUnique({ where: { id: partner.regionId }, select: { name: true, status: true, leadPartnerId: true } });
    if (!region?.leadPartnerId || region.status !== "ACTIVE" || region.leadPartnerId === salesPartnerId) return null;
    const lead = await db.salesPartnerProfile.findUnique({ where: { id: region.leadPartnerId }, select: { userId: true, status: true } });
    return lead && lead.status === "ACTIVE" ? { userId: lead.userId, regionName: region.name } : null;
  } catch {
    return null;
  }
}

export async function setRegionLead(db: any, regionId: number, agentCode: string | null, now = new Date()) {
  if (!agentCode) {
    await db.salesRegion.update({ where: { id: regionId }, data: { leadPartnerId: null, leadSince: null } });
    return null;
  }
  const partner = await db.salesPartnerProfile.findUnique({
    where: { agentCode: agentCode.trim().toUpperCase() },
    select: { id: true, status: true, contracts: { orderBy: { startsAt: "desc" }, take: 5 } },
  });
  if (!partner) throw new RegionError("No Sales Partner has that code.", 404);
  if (partner.status !== "ACTIVE" || !partner.contracts.some((c: any) => isContractEarning(c, now))) {
    throw new RegionError("A regional lead must be an active partner with a current contract.", 409);
  }
  const elsewhere = await db.salesRegion.findFirst({ where: { leadPartnerId: partner.id, id: { not: regionId } }, select: { name: true } });
  if (elsewhere) throw new RegionError(`This partner already leads ${elsewhere.name}.`, 409);
  const current = await db.salesRegion.findUnique({ where: { id: regionId }, select: { leadPartnerId: true } });
  await db.salesRegion.update({
    where: { id: regionId },
    // leadSince restarts only for a new lead, so overrides never reach back before them.
    data: { leadPartnerId: partner.id, ...(current?.leadPartnerId === partner.id ? {} : { leadSince: now }) },
  });
  await db.salesPartnerProfile.update({ where: { id: partner.id }, data: { regionId } });
  return partner.id;
}

// ---------- targets ----------

export async function regionTarget(db: any, regionId: number, month: string, partnerIds: number[]) {
  const set = await db.salesRegionMonth.findUnique({ where: { regionId_month: { regionId, month } }, select: { target: true } });
  if (set) return { target: set.target, setByAdmin: true };
  const rows = partnerIds.length
    ? await db.salesPartnerMonth.findMany({ where: { month, salesPartnerId: { in: partnerIds } }, select: { salesPartnerId: true, target: true } })
    : [];
  const byPartner = new Map(rows.map((r: any) => [r.salesPartnerId, r.target]));
  return { target: partnerIds.reduce((t, id) => t + Number(byPartner.get(id) ?? DEFAULT_MONTHLY_TARGET), 0), setByAdmin: false };
}

// ---------- the dashboard ----------

export async function regionDashboard(db: any, region: any, now = new Date()) {
  const month = monthKey(now);
  const { start, end } = monthRange(month);
  const partners = await db.salesPartnerProfile.findMany({
    where: { regionId: region.id, status: { in: ["ACTIVE", "PENDING", "SUSPENDED"] } },
    select: { id: true, agentCode: true, status: true, payoutHoldAt: true, user: { select: { name: true, fullName: true } } },
  });
  const ids: number[] = partners.map((p: any) => p.id);
  const others = ids.filter((id) => id !== region.leadPartnerId);

  const [board, health, target, inspections, objections, longStay, payouts, earned, override] = await Promise.all([
    computeBoard(month, now),
    computeTeamHealth(db, now),
    regionTarget(db, region.id, month, ids),
    ids.length ? db.longStayInspection.groupBy({ by: ["status"], where: { salesPartnerId: { in: ids }, reviewedAt: { gte: start, lt: end } }, _count: { _all: true } }).catch(() => []) : [],
    ids.length ? db.salesAssistedListing.count({ where: { salesPartnerId: { in: ids }, objectedAt: { gte: start, lt: end } } }).catch(() => 0) : 0,
    others.length ? db.longStayAccessRequest.findMany({ where: { salesPartnerId: { in: others }, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 50 }).catch(() => []) : [],
    others.length ? waitingFirstPayouts(db, others) : [],
    ids.length ? db.salesCommission.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: ids }, earnedAt: { gte: start, lt: end }, status: { notIn: CLOSED }, type: { not: "REGIONAL_OVERRIDE" } }, _sum: { commissionAmount: true } }) : [],
    region.leadPartnerId ? db.salesCommission.aggregate({ where: { salesPartnerId: region.leadPartnerId, type: "REGIONAL_OVERRIDE", earnedAt: { gte: start, lt: end }, status: { notIn: CLOSED } }, _sum: { commissionAmount: true } }) : null,
  ]);

  const entryOf = new Map(board.map((e) => [e.partnerId, e]));
  const earnedOf = new Map<number, number>(earned.map((r: any) => [r.salesPartnerId as number, Number(r._sum.commissionAmount ?? 0)]));
  const teams = health.filter((t) => ids.includes(t.lead.partnerId));
  const recommendations = await db.salesRegionRecommendation.findMany({
    where: { OR: [
      { subjectType: "LONG_STAY_REQUEST", subjectId: { in: longStay.map((r: any) => r.id) } },
      { subjectType: "SALES_PAYOUT", subjectId: { in: payouts.map((p: any) => p.id) } },
    ] },
    select: { subjectType: true, subjectId: true },
  }).catch(() => []);
  const recommended = new Set(recommendations.map((r: any) => `${r.subjectType}:${r.subjectId}`));
  const nameOf = (id: number) => {
    const p = partners.find((x: any) => x.id === id);
    return p?.user?.fullName || p?.user?.name || p?.agentCode || "Partner";
  };
  const confirmed = ids.reduce((t, id) => t + Number(entryOf.get(id)?.confirmed ?? 0), 0);
  const inspectionCount = (status: string) => Number(inspections.find((r: any) => r.status === status)?._count?._all ?? 0);

  return {
    region: { code: region.code, name: region.name, overridePercent: Number(region.overridePercent), leadSince: region.leadSince },
    month,
    target: { ...target, confirmed },
    summary: {
      partners: partners.filter((p: any) => p.status === "ACTIVE").length,
      teams: teams.length,
      earnedThisMonth: roundSalesMoney([...earnedOf.values()].reduce((a, b) => a + b, 0)),
      yourOverride: roundSalesMoney(Number(override?._sum?.commissionAmount ?? 0)),
      inspections: { passed: inspectionCount("PASSED"), failed: inspectionCount("FAILED") },
      ownerObjections: objections,
    },
    teams: teams.map((t) => ({ name: t.name, lead: t.lead.name, label: t.label, members: t.members, reasons: t.reasons.slice(0, 2), points: t.metrics.pointsThisMonth })),
    partners: partners
      .map((p: any) => {
        const e = entryOf.get(p.id);
        return {
          code: p.agentCode,
          name: p.user?.fullName || p.user?.name || p.agentCode,
          status: p.status,
          paused: Boolean(p.payoutHoldAt),
          isLead: p.id === region.leadPartnerId,
          points: e?.points ?? 0,
          confirmed: e?.confirmed ?? 0,
          visits: e?.visits ?? 0,
          denials: e?.denials ?? 0,
          earned: roundSalesMoney(earnedOf.get(p.id) ?? 0),
        };
      })
      .sort((a: any, b: any) => b.points - a.points),
    waiting: {
      longStayRequests: longStay.map((r: any) => ({ ref: r.publicRef, partner: nameOf(r.salesPartnerId), reason: r.reason, createdAt: r.createdAt, recommended: recommended.has(`LONG_STAY_REQUEST:${r.id}`) })),
      firstPayouts: payouts.map((p: any) => ({ ref: p.referenceNumber, partner: nameOf(p.salesPartnerId), amount: Number(p.requestedAmount), currency: p.currency, requestedAt: p.requestedAt, recommended: recommended.has(`SALES_PAYOUT:${p.id}`) })),
    },
  };
}

/** Withdrawals waiting for a person from partners who have never been paid before. */
async function waitingFirstPayouts(db: any, partnerIds: number[]) {
  const waiting = await db.salesPayoutRequest.findMany({
    where: { salesPartnerId: { in: partnerIds }, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
    select: { id: true, referenceNumber: true, salesPartnerId: true, requestedAmount: true, currency: true, requestedAt: true },
    orderBy: { requestedAt: "asc" },
    take: 50,
  });
  if (!waiting.length) return [];
  const paidBefore = await db.salesPayoutRequest.findMany({ where: { salesPartnerId: { in: waiting.map((w: any) => w.salesPartnerId) }, status: "PAID" }, select: { salesPartnerId: true } });
  const paid = new Set(paidBefore.map((r: any) => r.salesPartnerId));
  return waiting.filter((w: any) => !paid.has(w.salesPartnerId));
}

// ---------- recommendations ----------

export async function recommend(db: any, region: any, input: { subjectType: "LONG_STAY_REQUEST" | "SALES_PAYOUT"; ref: string; note: string | null }) {
  let subject: { id: number; salesPartnerId: number } | null = null;
  if (input.subjectType === "LONG_STAY_REQUEST") {
    const row = await db.longStayAccessRequest.findUnique({ where: { publicRef: input.ref } });
    if (row && row.status === "PENDING") subject = row;
  } else {
    const row = await db.salesPayoutRequest.findUnique({ where: { referenceNumber: input.ref }, select: { id: true, salesPartnerId: true, status: true } });
    if (row && ["REQUESTED", "UNDER_REVIEW"].includes(row.status)) subject = row;
  }
  if (!subject) throw new RegionError("This item is no longer waiting.", 404);
  if (subject.salesPartnerId === region.leadPartnerId) throw new RegionError("You cannot recommend your own request.", 403);
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: subject.salesPartnerId }, select: { regionId: true } });
  if (partner?.regionId !== region.id) throw new RegionError("This partner is not in your region.", 403);
  try {
    await db.salesRegionRecommendation.create({
      data: { regionId: region.id, leadPartnerId: region.leadPartnerId, subjectType: input.subjectType, subjectId: subject.id, note: input.note },
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    throw new RegionError("You already recommended this.", 409);
  }
  return { subjectId: subject.id, salesPartnerId: subject.salesPartnerId };
}

/** Recommendations for admin screens, keyed by subject id. Never throws. */
export async function recommendationsFor(db: any, subjectType: "LONG_STAY_REQUEST" | "SALES_PAYOUT", subjectIds: number[]) {
  if (!subjectIds.length) return new Map<number, { regionName: string; leadName: string; note: string | null; at: Date }>();
  try {
    const rows = await db.salesRegionRecommendation.findMany({ where: { subjectType, subjectId: { in: subjectIds } } });
    const [regions, leads] = await Promise.all([
      db.salesRegion.findMany({ where: { id: { in: rows.map((r: any) => r.regionId) } }, select: { id: true, name: true } }),
      db.salesPartnerProfile.findMany({ where: { id: { in: rows.map((r: any) => r.leadPartnerId) } }, select: { id: true, agentCode: true, user: { select: { name: true, fullName: true } } } }),
    ]);
    const regionName = new Map(regions.map((r: any) => [r.id, r.name]));
    const leadName = new Map(leads.map((l: any) => [l.id, l.user?.fullName || l.user?.name || l.agentCode]));
    return new Map(rows.map((r: any) => [r.subjectId, { regionName: String(regionName.get(r.regionId) ?? "Region"), leadName: String(leadName.get(r.leadPartnerId) ?? "Regional lead"), note: r.note, at: r.createdAt }]));
  } catch {
    return new Map();
  }
}

// ---------- override earnings ----------

/**
 * Accrues the lead's override on region partners' commissions, and reverses
 * overrides whose base was reversed. Idempotent on REGION_OVERRIDE:<base id>.
 */
export async function runRegionalOverrides(db: any, now = new Date()) {
  let accrued = 0;
  let reversed = 0;
  let regions: any[] = [];
  try {
    regions = await db.salesRegion.findMany({ where: { status: "ACTIVE", leadPartnerId: { not: null }, overridePercent: { gt: 0 } } });
  } catch (error: any) {
    if (error?.code === "P2021" || error?.code === "P2022") return { accrued, reversed };
    throw error;
  }
  for (const region of regions) {
    const lead = await db.salesPartnerProfile.findUnique({ where: { id: region.leadPartnerId }, select: { id: true, status: true, contracts: { orderBy: { startsAt: "desc" }, take: 5 } } });
    const contract = lead?.contracts?.find((c: any) => isContractEarning(c, now));
    if (!lead || lead.status !== "ACTIVE" || !contract) continue;
    const members = await db.salesPartnerProfile.findMany({ where: { regionId: region.id, id: { not: region.leadPartnerId } }, select: { id: true } });
    if (!members.length) continue;
    const bases = await db.salesCommission.findMany({
      where: {
        salesPartnerId: { in: members.map((m: any) => m.id) },
        type: { in: OVERRIDE_BASE_TYPES },
        status: { notIn: CLOSED },
        reversalOfId: null,
        commissionAmount: { gt: 0 },
        earnedAt: { gte: region.leadSince ?? now },
      },
      select: { id: true, propertyId: true, commissionAmount: true, currency: true, earnedAt: true, eligibleAt: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!bases.length) continue;
    const done = new Set((await db.salesCommission.findMany({ where: { sourceKey: { in: bases.map((b: any) => overrideSourceKey(b.id)) } }, select: { sourceKey: true } })).map((r: any) => r.sourceKey));
    const rate = Number(region.overridePercent);
    for (const base of bases) {
      if (done.has(overrideSourceKey(base.id))) continue;
      const amount = roundSalesMoney(Number(base.commissionAmount) * (rate / 100));
      if (amount <= 0) continue;
      try {
        await db.salesCommission.create({ data: {
          salesPartnerId: region.leadPartnerId,
          propertyId: base.propertyId,
          contractId: contract.id,
          type: "REGIONAL_OVERRIDE",
          status: "VALIDATING",
          sourceKey: overrideSourceKey(base.id),
          grossAmount: Number(base.commissionAmount),
          eligibleNetRevenue: Number(base.commissionAmount),
          commissionRate: rate,
          commissionAmount: amount,
          currency: base.currency,
          description: `${region.name} regional override`,
          earnedAt: base.earnedAt,
          // Checked against the base each run: never withdrawable before it.
          eligibleAt: base.eligibleAt ?? new Date(now.getTime() + DAY_MS),
        } });
        accrued += 1;
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
      }
    }
  }

  // Reverse overrides whose base no longer stands.
  const open = await db.salesCommission.findMany({
    where: { type: "REGIONAL_OVERRIDE", reversalOfId: null, status: { notIn: CLOSED } },
    select: { id: true, sourceKey: true },
    take: 2000,
  });
  const baseIds = open.map((o: any) => Number(String(o.sourceKey).split(":")[1])).filter((n: number) => Number.isSafeInteger(n));
  if (baseIds.length) {
    const gone = new Set((await db.salesCommission.findMany({ where: { id: { in: baseIds }, status: { in: CLOSED } }, select: { id: true } })).map((r: any) => r.id));
    for (const o of open) {
      const baseId = Number(String(o.sourceKey).split(":")[1]);
      if (!gone.has(baseId)) continue;
      const outcome = await db.$transaction((tx: any) => autoReverseSalesCommission(tx, o.id, "The partner's commission this override came from was reversed.", now), COMMISSION_TRANSACTION_OPTIONS);
      if (outcome === "REVERSED" || outcome === "OFFSET") reversed += 1;
    }
  }
  return { accrued, reversed };
}

/** For the lifecycle promotion step: is the override's base withdrawable yet? */
export async function overrideBaseReady(db: any, sourceKey: string): Promise<boolean> {
  const baseId = Number(String(sourceKey).split(":")[1]);
  if (!Number.isSafeInteger(baseId)) return false;
  const base = await db.salesCommission.findUnique({ where: { id: baseId }, select: { status: true } });
  return Boolean(base && WITHDRAWABLE.includes(base.status));
}
