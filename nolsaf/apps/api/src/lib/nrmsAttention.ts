import { getRedis } from "./redis.js";
import { shiftDateOnly, shiftDayKey } from "./nrmsShifts.js";

const CACHE_TTL_MS = 15_000;
const CACHE_TTL_SECONDS = Math.ceil(CACHE_TTL_MS / 1_000);
const memoryCache = new Map<string, { expiresAt: number; value: NrmsAttentionSnapshot }>();
const inFlight = new Map<string, Promise<NrmsAttentionSnapshot>>();
const OWNER_ACTION_STATES = new Set(["ACTION_REQUIRED", "ADMIN_REJECTED", "PROVIDER_ACTION_REQUIRED"]);
const LIVE_ORDER_STATUSES = ["PLACED", "CONFIRMED", "PREPARING", "SERVING"];

export type NrmsAttentionAccess = {
  role: string;
  outletId?: number | null;
};

export type NrmsAttentionSnapshot = {
  generatedAt: string;
  refreshAfterSeconds: number;
  frontDesk: { arrivals: number; departures: number; total: number };
  inquiries: { new: number; open: number; overdue: number; total: number };
  groups: { dueStays: number; blockReviews: number; total: number };
  housekeeping: { tasks: number; untrackedRooms: number; total: number };
  orders: {
    openRoom: number;
    openTable: number;
    placedRoom: number;
    placedTable: number;
    total: number;
    byOutlet: Array<{ outletId: number; openRoom: number; placedRoom: number }>;
  };
  stock: { low: number; out: number; total: number };
  agents: { partnershipRequests: number; acceptedInvites: number; bookingRequests: number; guestManifests: number; total: number };
  rateProposals: { pending: number; total: number };
  channels: { connections: number; alerts: number; issues: number; total: number };
  finance: { unclassifiedTenders: number; overdueBusinessDays: number; total: number };
  payments: { actionRequired: number; total: number };
};

const zeroSnapshot = (): NrmsAttentionSnapshot => ({
  generatedAt: new Date().toISOString(),
  refreshAfterSeconds: 60,
  frontDesk: { arrivals: 0, departures: 0, total: 0 },
  inquiries: { new: 0, open: 0, overdue: 0, total: 0 },
  groups: { dueStays: 0, blockReviews: 0, total: 0 },
  housekeeping: { tasks: 0, untrackedRooms: 0, total: 0 },
  orders: { openRoom: 0, openTable: 0, placedRoom: 0, placedTable: 0, total: 0, byOutlet: [] },
  stock: { low: 0, out: 0, total: 0 },
  agents: { partnershipRequests: 0, acceptedInvites: 0, bookingRequests: 0, guestManifests: 0, total: 0 },
  rateProposals: { pending: 0, total: 0 },
  channels: { connections: 0, alerts: 0, issues: 0, total: 0 },
  finance: { unclassifiedTenders: 0, overdueBusinessDays: 0, total: 0 },
  payments: { actionRequired: 0, total: 0 },
});

function sectionAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

/** Build the active-work snapshot without historical or informational counters. */
export async function buildNrmsAttentionSnapshot(
  db: any,
  propertyId: number,
  access: NrmsAttentionAccess,
  now = new Date(),
): Promise<NrmsAttentionSnapshot> {
  const result = zeroSnapshot();
  const role = access.role;
  const today = shiftDateOnly(shiftDayKey(now));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const overdueBefore = new Date(now.getTime() - 10 * 60_000);

  const frontDeskPromise = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK"])
    ? db.reservation.findMany({
        where: {
          propertyId,
          groupId: null,
          OR: [
            { status: "CONFIRMED", checkIn: { lt: tomorrow } },
            { status: "CHECKED_IN", checkOut: { lt: tomorrow } },
          ],
        },
        select: { status: true },
      })
    : Promise.resolve([]);

  const inquiryPromise = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK", "SALES_EXECUTIVE"])
    ? Promise.all([
        db.nrmsGuestInquiry.groupBy({ by: ["status"], where: { propertyId, status: { in: ["NEW", "OPEN"] } }, _count: { _all: true } }),
        db.nrmsGuestInquiry.count({ where: { propertyId, status: { in: ["NEW", "OPEN"] }, firstResponseAt: null, createdAt: { lt: overdueBefore } } }),
      ])
    : Promise.resolve([[], 0]);

  const groupPromise = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK", "SALES_EXECUTIVE"])
    ? Promise.all([
        db.reservation.findMany({
          where: {
            propertyId,
            groupId: { not: null },
            OR: [
              { status: "CONFIRMED", checkIn: { lt: tomorrow } },
              { status: "CHECKED_IN", checkOut: { lt: tomorrow } },
            ],
          },
          distinct: ["groupId"],
          select: { groupId: true },
        }),
        db.nrmsGroupBlock.count({
          where: {
            propertyId,
            OR: [
              { roomingList: { is: { status: "SUBMITTED" } } },
              { status: { in: ["HELD", "PARTIALLY_PICKED_UP"] }, cutOffAt: { lte: now } },
            ],
          },
        }),
      ])
    : Promise.resolve([[], 0]);

  const housekeepingPromise = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK"])
    ? Promise.all([
        db.nrmsHousekeepingTask.count({ where: { propertyId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        db.roomUnit.count({
          where: {
            propertyId,
            housekeepingStatus: { in: ["DIRTY", "IN_PROGRESS"] },
            housekeepingTasks: { none: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
          },
        }),
      ])
    : Promise.resolve([0, 0]);

  const outletRole = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK", "OUTLET_SUPERVISOR", "RESTAURANT", "BAR"]);
  const outletScope = access.outletId != null
    ? { outletId: access.outletId }
    : role === "BAR"
      ? { outlet: { is: { type: "BAR" } } }
      : role === "RESTAURANT"
        ? { outlet: { is: { type: "RESTAURANT" } } }
        : {};
  const ordersPromise = outletRole
    ? db.nrmsOutletOrder.findMany({
        where: { propertyId, status: { in: LIVE_ORDER_STATUSES }, ...outletScope },
        select: { outletId: true, status: true, reservationId: true, orderPoint: { select: { type: true } } },
      })
    : Promise.resolve([]);

  const stockPromise = sectionAllowed(role, ["OWNER", "MANAGER", "OUTLET_SUPERVISOR", "RESTAURANT", "BAR"])
    ? db.nrmsMenuItem.findMany({
        where: { status: "ACTIVE", outlet: { is: { propertyId, status: "ACTIVE", ...(role === "BAR" ? { type: "BAR" } : role === "RESTAURANT" ? { type: "RESTAURANT" } : {}), ...(access.outletId != null ? { id: access.outletId } : {}) } } },
        select: { inStock: true, stockQuantity: true, lowStockThreshold: true },
      })
    : Promise.resolve([]);

  const agentsPromise = sectionAllowed(role, ["OWNER", "MANAGER", "SALES_EXECUTIVE"])
    ? Promise.all([
        db.nrmsAgentPropertyLink.findMany({ where: { propertyId, OR: [{ initiatedBy: "AGENT", status: "REQUESTED" }, { status: "AGENT_ACCEPTED" }] }, select: { status: true, initiatedBy: true } }),
        db.nrmsAgentBookingRequest.findMany({ where: { propertyId, OR: [{ status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] }, { status: "CONFIRMED", guestManifestStatus: "SUBMITTED" }] }, select: { status: true, guestManifestStatus: true } }),
      ])
    : Promise.resolve([[], []]);

  const ratePromise = sectionAllowed(role, ["OWNER", "SALES_EXECUTIVE"])
    ? db.nrmsPricingRecommendation.count({ where: { propertyId, status: "PENDING", factors: { path: "$.source", equals: "SALES_EXECUTIVE" } } })
    : Promise.resolve(0);

  const channelsPromise = role === "OWNER"
    ? db.channelConnection.findMany({
        where: { propertyId },
        select: {
          status: true,
          operationalAlerts: { where: { status: "OPEN" }, select: { id: true } },
          reconciliationIssues: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true } },
        },
      })
    : Promise.resolve([]);

  const financePromise = sectionAllowed(role, ["OWNER", "MANAGER", "FRONT_DESK"])
    ? Promise.all([
        db.nrmsOutletOrder.count({ where: { propertyId, status: "SETTLED", settlementMode: "OUTLET_PAYMENT", settlementMethod: null } }),
        db.nrmsBusinessDay.count({ where: { propertyId, status: { in: ["OPEN", "CLOSING"] }, businessDate: { lt: today } } }),
      ])
    : Promise.resolve([0, 0]);

  const paymentsPromise = role === "OWNER"
    ? db.property.findFirst({
        where: { id: propertyId },
        select: {
          merchantLinks: {
            where: { outletId: null, effectiveTo: null },
            take: 1,
            select: { merchant: { select: {
              applications: { orderBy: { version: "desc" }, take: 1, select: { status: true } },
              providerAccounts: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true } },
            } } },
          },
        },
      })
    : Promise.resolve(null);

  const [frontDeskRows, inquiryRows, groupRows, housekeepingRows, orderRows, stockRows, agentRows, pendingRates, channelRows, financeRows, paymentProperty] = await Promise.all([
    frontDeskPromise, inquiryPromise, groupPromise, housekeepingPromise, ordersPromise, stockPromise, agentsPromise, ratePromise, channelsPromise, financePromise, paymentsPromise,
  ]);

  result.frontDesk.arrivals = frontDeskRows.filter((row: any) => row.status === "CONFIRMED").length;
  result.frontDesk.departures = frontDeskRows.filter((row: any) => row.status === "CHECKED_IN").length;
  result.frontDesk.total = result.frontDesk.arrivals + result.frontDesk.departures;

  const [inquiryGroups, overdue] = inquiryRows as [any[], number];
  result.inquiries.new = Number(inquiryGroups.find((row) => row.status === "NEW")?._count?._all ?? 0);
  result.inquiries.open = Number(inquiryGroups.find((row) => row.status === "OPEN")?._count?._all ?? 0);
  result.inquiries.overdue = Number(overdue);
  result.inquiries.total = result.inquiries.new + result.inquiries.open;

  result.groups.dueStays = (groupRows[0] as any[]).length;
  result.groups.blockReviews = Number(groupRows[1]);
  result.groups.total = result.groups.dueStays + result.groups.blockReviews;
  result.housekeeping.tasks = Number(housekeepingRows[0]);
  result.housekeeping.untrackedRooms = Number(housekeepingRows[1]);
  result.housekeeping.total = result.housekeeping.tasks + result.housekeeping.untrackedRooms;

  const orderByOutlet = new Map<number, { outletId: number; openRoom: number; placedRoom: number }>();
  for (const row of orderRows as any[]) {
    const roomOrder = row.reservationId != null || row.orderPoint?.type === "ROOM";
    if (roomOrder) {
      result.orders.openRoom += 1;
      if (row.status === "PLACED") result.orders.placedRoom += 1;
      const outlet = orderByOutlet.get(Number(row.outletId)) ?? { outletId: Number(row.outletId), openRoom: 0, placedRoom: 0 };
      outlet.openRoom += 1;
      if (row.status === "PLACED") outlet.placedRoom += 1;
      orderByOutlet.set(outlet.outletId, outlet);
    } else {
      result.orders.openTable += 1;
      if (row.status === "PLACED") result.orders.placedTable += 1;
    }
  }
  result.orders.byOutlet = [...orderByOutlet.values()].sort((a, b) => a.outletId - b.outletId);
  result.orders.total = result.orders.openRoom + result.orders.openTable;

  for (const item of stockRows as any[]) {
    if (!item.inStock) result.stock.out += 1;
    else if (item.stockQuantity != null && Number(item.stockQuantity) <= Number(item.lowStockThreshold)) result.stock.low += 1;
  }
  result.stock.total = result.stock.low + result.stock.out;

  const [links, requests] = agentRows as [any[], any[]];
  result.agents.partnershipRequests = links.filter((row) => row.status === "REQUESTED" && row.initiatedBy === "AGENT").length;
  result.agents.acceptedInvites = links.filter((row) => row.status === "AGENT_ACCEPTED").length;
  result.agents.bookingRequests = requests.filter((row) => row.status === "PENDING").length;
  result.agents.guestManifests = requests.filter((row) => row.status === "CONFIRMED" && row.guestManifestStatus === "SUBMITTED").length;
  result.agents.total = result.agents.partnershipRequests + result.agents.acceptedInvites + result.agents.bookingRequests + result.agents.guestManifests;
  result.rateProposals.pending = Number(pendingRates);
  result.rateProposals.total = result.rateProposals.pending;

  result.channels.connections = (channelRows as any[]).filter((row) => ["ERROR", "STALE"].includes(row.status)).length;
  result.channels.alerts = (channelRows as any[]).reduce((sum, row) => sum + row.operationalAlerts.length, 0);
  result.channels.issues = (channelRows as any[]).reduce((sum, row) => sum + row.reconciliationIssues.length, 0);
  result.channels.total = result.channels.connections + result.channels.alerts + result.channels.issues;

  result.finance.unclassifiedTenders = Number(financeRows[0]);
  result.finance.overdueBusinessDays = Number(financeRows[1]);
  result.finance.total = result.finance.unclassifiedTenders + result.finance.overdueBusinessDays;

  const merchant = (paymentProperty as any)?.merchantLinks?.[0]?.merchant;
  const applicationStatus = merchant?.applications?.[0]?.status ?? null;
  const providerStatus = merchant?.providerAccounts?.[0]?.status ?? null;
  result.payments.actionRequired = (OWNER_ACTION_STATES.has(applicationStatus) || OWNER_ACTION_STATES.has(providerStatus)) ? 1 : 0;
  result.payments.total = result.payments.actionRequired;
  return result;
}

export async function getNrmsAttentionSnapshot(
  db: any,
  propertyId: number,
  access: NrmsAttentionAccess,
  options: { fresh?: boolean } = {},
): Promise<NrmsAttentionSnapshot> {
  const cacheKey = `nrms:attention:v1:${propertyId}:${access.role}:${access.outletId ?? "all"}`;
  const local = memoryCache.get(cacheKey);
  if (!options.fresh && local && local.expiresAt > Date.now()) return local.value;

  if (!options.fresh && process.env.REDIS_URL) {
    try {
      const cached = await getRedis()?.get(cacheKey);
      if (cached) {
        const value = JSON.parse(cached) as NrmsAttentionSnapshot;
        memoryCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      }
    } catch { /* best-effort shared cache */ }
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;
  const pending = buildNrmsAttentionSnapshot(db, propertyId, access).then(async (value) => {
    memoryCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (process.env.REDIS_URL) {
      try { await getRedis()?.set(cacheKey, JSON.stringify(value), "EX", CACHE_TTL_SECONDS); } catch { /* best-effort shared cache */ }
    }
    return value;
  }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, pending);
  return pending;
}
