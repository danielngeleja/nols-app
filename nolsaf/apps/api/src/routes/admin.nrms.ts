// apps/api/src/routes/admin.nrms.ts
//
// NRMS Admin Oversight, Phase 1: the read-only Observatory
// (docs/NRMS_ADMIN_OVERSIGHT.md). Admin oversees, never operates: this file
// contains no writes and must stay that way. Enforcement (phase 2) and
// commercial levers (phase 3) get their own endpoints with audit + 2FA.

import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant } from "../middleware/financeGrant.js";
import { NRMS_PLAN_CODE } from "../lib/nrms.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);
router.use(blockImpersonated as unknown as RequestHandler);

const db = prisma as any;

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function countBy(rows: Array<{ propertyId: number; _count: { _all: number } }>): Map<number, number> {
  return new Map(rows.map((row) => [row.propertyId, row._count._all]));
}

function pageQuery(req: any) {
  return {
    limit: Math.min(100, Math.max(1, Number(req.query.limit) || 25)),
    cursor: req.query.cursor ? Number(req.query.cursor) : null,
  };
}

function pageResult(rows: any[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { page, pagination: { limit, nextCursor: hasMore ? page[page.length - 1].id : null } };
}

/**
 * GET /api/admin/nrms/directory
 * Every NRMS enrollment and every activated property with its health signals.
 */
router.get("/directory", (async (req, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const enrollments = await db.ownerServiceEnrollment.findMany({
    where: { plan: { code: NRMS_PLAN_CODE } },
    include: {
      owner: { select: { id: true, fullName: true, name: true, email: true, phone: true } },
      plan: { select: { code: true, status: true } },
    },
    orderBy: { id: "asc" },
  });

  const accounts = await db.ownerPaygAccount.findMany({
    include: {
      property: { select: { id: true, title: true, status: true, nrmsActivatedAt: true, regionName: true } },
      policy: { select: { version: true, roomNightPrice: true, trialDays: true, currency: true } },
    },
    ...(cursor ? { where: { id: { gt: cursor } } } : {}),
    orderBy: { id: "asc" },
    take: limit + 1,
  });

  const hasMore = accounts.length > limit;
  const pageAccounts = hasMore ? accounts.slice(0, limit) : accounts;

  const propertyIds = pageAccounts.map((a: any) => a.propertyId);
  const [staffCounts, outletCounts, pointCounts, roomCounts, lastOrders, lastAudits] = await Promise.all([
    db.nrmsStaffMembership.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, status: "ACTIVE" }, _count: { _all: true } }),
    db.nrmsOutlet.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, status: "ACTIVE" }, _count: { _all: true } }),
    db.nrmsOrderPoint.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, active: true }, _count: { _all: true } }),
    db.roomUnit.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, status: "ACTIVE" }, _count: { _all: true } }),
    db.nrmsOutletOrder.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds } }, _max: { createdAt: true } }),
    db.nrmsNightAuditRun.groupBy({ by: ["propertyId"], where: { propertyId: { in: propertyIds }, status: "CLOSED" }, _max: { completedAt: true } }),
  ]);

  // Platform-wide "would you book through NoLSAF again". This is NoLSAF's own
  // channel-loyalty signal, not a hotel's performance, so it is reported here
  // and deliberately never returned to owners.
  const intentRows = await db.nrmsReviewRequest.groupBy({
    by: ["platformIntent"],
    where: { platformIntent: { not: null } },
    _count: { _all: true },
  });
  const reviewIntent = { YES: 0, MAYBE: 0, NO: 0 } as Record<string, number>;
  for (const row of intentRows) {
    const key = String(row.platformIntent ?? "").toUpperCase();
    if (key in reviewIntent) reviewIntent[key] = row._count._all;
  }

  const staffMap = countBy(staffCounts);
  const outletMap = countBy(outletCounts);
  const pointMap = countBy(pointCounts);
  const roomMap = countBy(roomCounts);
  const lastOrderMap = new Map<number, Date | null>(lastOrders.map((row: any) => [row.propertyId, row._max.createdAt]));
  const lastAuditMap = new Map<number, Date | null>(lastAudits.map((row: any) => [row.propertyId, row._max.completedAt]));

  res.json({
    enrollments: enrollments.map((e: any) => ({
      id: e.id,
      status: e.status,
      planStatus: e.plan.status,
      trialStartsAt: e.trialStartsAt,
      trialEndsAt: e.trialEndsAt,
      activatedAt: e.activatedAt,
      suspendedAt: e.suspendedAt,
      cancelledAt: e.cancelledAt,
      owner: e.owner,
    })),
    properties: pageAccounts.map((a: any) => ({
      accountId: a.id,
      propertyId: a.propertyId,
      ownerId: a.ownerId,
      title: a.property?.title ?? `Property #${a.propertyId}`,
      region: a.property?.regionName ?? null,
      propertyStatus: a.property?.status ?? null,
      nrmsActivatedAt: a.property?.nrmsActivatedAt ?? null,
      accountStatus: a.status,
      trialEndsAt: a.trialEndsAt,
      unpaidBalance: n(a.unpaidBalance),
      unpaidLimit: n(a.unpaidLimit),
      policy: a.policy ? { version: a.policy.version, roomNightPrice: n(a.policy.roomNightPrice), trialDays: a.policy.trialDays, currency: a.policy.currency } : null,
      rooms: roomMap.get(a.propertyId) ?? 0,
      activeStaff: staffMap.get(a.propertyId) ?? 0,
      activeOutlets: outletMap.get(a.propertyId) ?? 0,
      activeOrderPoints: pointMap.get(a.propertyId) ?? 0,
      lastOrderAt: lastOrderMap.get(a.propertyId) ?? null,
      lastNightAuditAt: lastAuditMap.get(a.propertyId) ?? null,
    })),
    pagination: { limit, nextCursor: hasMore ? pageAccounts[pageAccounts.length - 1].id : null },
    reviewIntent,
  });
}) as RequestHandler);

/**
 * GET /api/admin/nrms/property/:propertyId
 * One property's full oversight picture. Read only, guest PII kept minimal.
 */
router.get("/property/:propertyId", (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) return res.status(400).json({ error: "Invalid property id" });

  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      title: true,
      status: true,
      regionName: true,
      nrmsActivatedAt: true,
      nrmsGuestPayInstructions: true,
      nrmsQrOrderingFrozenAt: true,
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: true,
      owner: { select: { id: true, fullName: true, name: true, email: true, phone: true } },
    },
  });
  if (!property) return res.status(404).json({ error: "Property not found" });

  const enrollment = await db.ownerServiceEnrollment.findFirst({
    where: { ownerId: property.owner.id, plan: { code: NRMS_PLAN_CODE } },
    select: { id: true, status: true, suspendedAt: true },
  });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [account, restrictionCases, staff, outlets, orderPoints, roomsByHk, orderStats, orderTotals, qrOrderCount, nightAudits, cashierShifts, openBusinessDay] = await Promise.all([
    db.ownerPaygAccount.findUnique({ where: { propertyId }, include: { policy: { select: { version: true, roomNightPrice: true, currency: true } } } }),
    db.platformRestrictionCase.findMany({
      where: {
        status: "OPEN",
        OR: [
          { scope: "NRMS_ENROLLMENT", targetId: property.owner.id },
          { propertyId },
        ],
      },
      orderBy: { id: "desc" },
      select: { referenceCode: true, scope: true, reason: true, appliedAt: true, notificationEmailSentAt: true, notificationEmailError: true },
    }),
    db.nrmsStaffMembership.findMany({
      where: { propertyId },
      include: {
        user: { select: { id: true, fullName: true, name: true, email: true } },
        outlet: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ status: "asc" }, { id: "asc" }],
    }),
    db.nrmsOutlet.findMany({
      where: { propertyId },
      select: {
        id: true, name: true, code: true, type: true, status: true, currency: true, autoAcceptQrOrders: true,
        _count: { select: { menuItems: { where: { status: "ACTIVE" } }, orders: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    db.nrmsOrderPoint.findMany({
      where: { propertyId },
      select: { id: true, type: true, label: true, active: true, createdAt: true, updatedAt: true, roomUnit: { select: { code: true, floor: true } } },
      orderBy: [{ type: "asc" }, { label: "asc" }],
    }),
    db.roomUnit.groupBy({ by: ["housekeepingStatus"], where: { propertyId, status: "ACTIVE" }, _count: { _all: true } }),
    db.nrmsOutletOrder.groupBy({ by: ["status"], where: { propertyId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.nrmsOutletOrder.aggregate({
      where: { propertyId, createdAt: { gte: since }, status: { in: ["SETTLED", "POSTED_TO_FOLIO"] } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.nrmsOutletOrder.count({ where: { propertyId, createdAt: { gte: since }, orderPointId: { not: null } } }),
    db.nrmsNightAuditRun.findMany({
      where: { propertyId },
      select: { id: true, status: true, reportNumber: true, startedAt: true, completedAt: true, businessDay: { select: { businessDate: true } } },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    db.nrmsCashierShift.findMany({
      where: { propertyId },
      select: { id: true, businessDate: true, status: true, currency: true, expectedCash: true, declaredCash: true, variance: true, user: { select: { fullName: true, name: true } } },
      orderBy: { openedAt: "desc" },
      take: 10,
    }),
    db.nrmsBusinessDay.findFirst({ where: { propertyId, status: "OPEN" }, select: { businessDate: true, openedAt: true } }),
  ]);

  res.json({
    property: {
      ...property,
      guestPayInstructions: Array.isArray(property.nrmsGuestPayInstructions) ? property.nrmsGuestPayInstructions : [],
      nrmsGuestPayInstructions: undefined,
      qrOrderingFrozenAt: property.nrmsQrOrderingFrozenAt,
      nrmsQrOrderingFrozenAt: undefined,
    },
    enrollment,
    restrictionCases,
    account: account
      ? {
          id: account.id,
          status: account.status,
          freezePreviousStatus: account.freezePreviousStatus ?? null,
          frozenAt: account.frozenAt ?? null,
          frozenReason: account.frozenReason ?? null,
          trialStartsAt: account.trialStartsAt,
          trialEndsAt: account.trialEndsAt,
          unpaidBalance: n(account.unpaidBalance),
          unpaidLimit: n(account.unpaidLimit),
          policy: account.policy ? { version: account.policy.version, roomNightPrice: n(account.policy.roomNightPrice), currency: account.policy.currency } : null,
        }
      : null,
    staff: staff.map((m: any) => ({
      membershipId: m.id,
      role: m.role,
      status: m.status,
      outlet: m.outlet,
      user: { id: m.user.id, name: m.user.fullName || m.user.name || "Unnamed", email: m.user.email },
      since: m.createdAt,
      confirmedAt: m.confirmedAt,
    })),
    outlets: outlets.map((o: any) => ({ ...o, activeMenuItems: o._count.menuItems, totalOrders: o._count.orders, _count: undefined })),
    orderPoints,
    housekeeping: roomsByHk.map((row: any) => ({ status: row.housekeepingStatus, count: row._count._all })),
    orders30d: {
      byStatus: orderStats.map((row: any) => ({ status: row.status, count: row._count._all })),
      completedCount: orderTotals._count._all,
      completedTotal: n(orderTotals._sum.total),
      qrCount: qrOrderCount,
    },
    nightAudits,
    cashierShifts: cashierShifts.map((s: any) => ({
      ...s,
      expectedCash: n(s.expectedCash),
      declaredCash: s.declaredCash == null ? null : n(s.declaredCash),
      variance: s.variance == null ? null : n(s.variance),
      operator: s.user?.fullName || s.user?.name || "Unknown",
      user: undefined,
    })),
    openBusinessDay,
  });
}) as RequestHandler);

/**
 * GET /api/admin/nrms/billing
 * The PAYG collections board: accounts by status, open statements, payment tokens.
 */
router.get("/billing", requireFinanceGrant as unknown as RequestHandler, (async (_req, res: Response) => {
  const [accounts, openStatements, processingTokens, recentPayments] = await Promise.all([
    db.ownerPaygAccount.findMany({
      include: {
        property: { select: { id: true, title: true } },
        owner: { select: { id: true, fullName: true, name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { unpaidBalance: "desc" }],
    }),
    db.nrmsBillingStatement.findMany({
      where: { status: "PAYABLE" },
      include: { account: { select: { propertyId: true, property: { select: { title: true } } } } },
      orderBy: { closedAt: "asc" },
      take: 100,
    }),
    db.nrmsServicePaymentToken.findMany({
      where: { status: "PROCESSING" },
      include: { statement: { select: { id: true, account: { select: { propertyId: true, property: { select: { title: true } } } } } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.nrmsServicePayment.findMany({
      include: { token: { select: { statementId: true, statement: { select: { account: { select: { propertyId: true, property: { select: { title: true } } } } } } } } },
      orderBy: { id: "desc" },
      take: 20,
    }),
  ]);

  res.json({
    accounts: accounts.map((a: any) => ({
      id: a.id,
      propertyId: a.propertyId,
      propertyTitle: a.property?.title ?? `Property #${a.propertyId}`,
      owner: { id: a.owner?.id, name: a.owner?.fullName || a.owner?.name || "Unknown", email: a.owner?.email ?? null },
      status: a.status,
      trialEndsAt: a.trialEndsAt,
      unpaidBalance: n(a.unpaidBalance),
      unpaidLimit: n(a.unpaidLimit),
    })),
    openStatements: openStatements.map((s: any) => ({
      id: s.id,
      propertyId: s.account?.propertyId ?? null,
      propertyTitle: s.account?.property?.title ?? "Unknown property",
      amount: n(s.amount),
      currency: s.currency,
      closedAt: s.closedAt,
    })),
    processingTokens: processingTokens.map((t: any) => ({
      id: t.id,
      token: t.token,
      statementId: t.statementId,
      propertyTitle: t.statement?.account?.property?.title ?? "Unknown property",
      amount: n(t.amount),
      currency: t.currency,
      method: t.method,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    })),
    recentPayments,
  });
}) as RequestHandler);

// Read-only investigation endpoints. Each is cursor-paginated so an admin
// cannot accidentally load an entire property's financial history.
router.get("/property/:propertyId/orders", requireFinanceGrant as unknown as RequestHandler, (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const { limit, cursor } = pageQuery(req);
  const rows = await db.nrmsOutletOrder.findMany({
    where: { propertyId, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: {
      outlet: { select: { id: true, name: true, code: true } },
      orderPoint: { select: { id: true, type: true, label: true } },
      items: { select: { id: true, nameSnapshot: true, quantity: true, unitPrice: true, lineTotal: true } },
      reservation: { select: { id: true, status: true, receiptNumber: true } },
    },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const result = pageResult(rows, limit);
  res.json({ orders: result.page.map((order: any) => ({ ...order, subtotal: n(order.subtotal), total: n(order.total), paymentAmountReceived: n(order.paymentAmountReceived), items: order.items.map((item: any) => ({ ...item, unitPrice: n(item.unitPrice), lineTotal: n(item.lineTotal) })) })), pagination: result.pagination });
}) as RequestHandler);

router.get("/property/:propertyId/ledger", requireFinanceGrant as unknown as RequestHandler, (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const { limit, cursor } = pageQuery(req);
  const rows = await db.nrmsLedgerTransaction.findMany({
    where: { propertyId, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: { entries: true, businessDay: { select: { businessDate: true } }, nightAuditRun: { select: { reportNumber: true, status: true } } },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const result = pageResult(rows, limit);
  res.json({ transactions: result.page.map((row: any) => ({ ...row, entries: row.entries.map((entry: any) => ({ ...entry, debit: n(entry.debit), credit: n(entry.credit) })) })), pagination: result.pagination });
}) as RequestHandler);

router.get("/property/:propertyId/folio-charges", requireFinanceGrant as unknown as RequestHandler, (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const { limit, cursor } = pageQuery(req);
  const rows = await db.reservationCharge.findMany({
    where: { reservation: { propertyId }, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: { reservation: { select: { id: true, status: true, receiptNumber: true } }, postedBy: { select: { id: true, fullName: true, name: true } } },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const result = pageResult(rows, limit);
  res.json({ charges: result.page.map((row: any) => ({ ...row, amount: n(row.amount) })), pagination: result.pagination });
}) as RequestHandler);

router.get("/property/:propertyId/night-audits", requireFinanceGrant as unknown as RequestHandler, (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const { limit, cursor } = pageQuery(req);
  const rows = await db.nrmsNightAuditRun.findMany({
    where: { propertyId, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: { businessDay: { select: { businessDate: true, status: true } } },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const result = pageResult(rows, limit);
  res.json({ audits: result.page, pagination: result.pagination });
}) as RequestHandler);

router.get("/property/:propertyId/cashier-shifts", requireFinanceGrant as unknown as RequestHandler, (async (req, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const { limit, cursor } = pageQuery(req);
  const rows = await db.nrmsCashierShift.findMany({
    where: { propertyId, ...(cursor ? { id: { lt: cursor } } : {}) },
    include: { user: { select: { id: true, fullName: true, name: true } }, approvedBy: { select: { id: true, fullName: true, name: true } } },
    orderBy: { id: "desc" }, take: limit + 1,
  });
  const result = pageResult(rows, limit);
  res.json({ shifts: result.page.map((row: any) => ({ ...row, openingFloat: n(row.openingFloat), expectedCash: n(row.expectedCash), declaredCash: row.declaredCash == null ? null : n(row.declaredCash), variance: row.variance == null ? null : n(row.variance) })), pagination: result.pagination });
}) as RequestHandler);

export default router;
