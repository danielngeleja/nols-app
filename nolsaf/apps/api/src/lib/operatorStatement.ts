/**
 * Tour operator statement: everything one operator did on NoLSAF over a
 * period, for an administrator to read, print and file. The operator
 * counterpart of the owner statement (GET /admin/owners/:id/statement).
 *
 * Built for disputes and reviews: a tier challenge, a suspension, a refund
 * argument, or a licensing or tax query. Every money line carries the
 * reference needed to trace it, and the behaviour section turns the operator's
 * own trip records into signals of whether they deliver what they sell.
 *
 * Read-only. Money of record is TZS.
 */
import { prisma } from "@nolsaf/prisma";
import { computeAgentLevel, resolveTierLadder } from "./agentLevel.js";
import { readContractWorkflow } from "./agentContractWorkflow.js";
import { isAdvanceRow } from "./tourPayouts.js";
import { offsetAppliedOf } from "./tourRecoveryOffset.js";
import { operatorPackageRegister } from "./operatorPackages.js";

const OPEN_CASE_STATUSES = new Set(["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"]);
const STARTED_STATUSES = new Set(["IN_PROGRESS", "OPERATOR_COMPLETED", "COMPLETED"]);
const PAYOUT_PAID = new Set(["DISBURSED", "PAID"]);
const PAYOUT_IN_FLIGHT = new Set(["CLAIMED", "VERIFIED", "APPROVED"]);

const upper = (v: unknown) => String(v ?? "").trim().toUpperCase();
const num = (v: unknown) => Number(v ?? 0) || 0;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

const hoursBetween = (a: Date | null | undefined, b: Date | null | undefined) =>
  a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : NaN;

function isPaid(b: { paymentStatus?: string | null; paidAt?: Date | null }) {
  return upper(b.paymentStatus) === "PAID" || Boolean(b.paidAt);
}

function pickupValidated(metadata: unknown): boolean {
  const md = metadata && typeof metadata === "object" ? (metadata as any) : {};
  return md?.pickupValidation?.validated === true;
}

export type BehaviourBooking = {
  status: string;
  paymentStatus: string | null;
  paidAt: Date | null;
  confirmedAt: Date | null;
  endDate: Date | null;
  operatorCompletedAt: Date | null;
  customerConfirmedAt: Date | null;
  metadata: unknown;
};

export type OperatorBehaviour = {
  bookings: number;
  paidBookings: number;
  /** Trips that reached IN_PROGRESS or later. */
  tripsStarted: number;
  pickupValidated: number;
  pickupValidatedRate: number | null;
  completed: number;
  travellerConfirmed: number;
  autoCompleted: number;
  travellerConfirmedRate: number | null;
  cancelledAfterPayment: number;
  cancellationRate: number | null;
  cases: number;
  openCases: number;
  casesPer100Paid: number | null;
  payoutClaimsRejected: number;
  /** Median hours from payment to the operator confirming the booking. */
  medianHoursToConfirm: number | null;
  /** Median hours from the trip's last day to the operator marking it finished. */
  medianHoursToFinish: number | null;
  reviews: number;
  averageRating: number | null;
};

/** Pure: behaviour signals from the operator's own records in the period. */
export function operatorBehaviour(input: {
  bookings: BehaviourBooking[];
  caseStatuses: string[];
  payoutStatuses: string[];
  ratings: number[];
}): OperatorBehaviour {
  const bookings = input.bookings;
  const paid = bookings.filter(isPaid);
  const started = bookings.filter((b) => STARTED_STATUSES.has(upper(b.status)));
  const validated = started.filter((b) => pickupValidated(b.metadata));
  const completed = bookings.filter((b) => upper(b.status) === "COMPLETED");
  const confirmed = completed.filter((b) => Boolean(b.customerConfirmedAt));
  const cancelled = paid.filter((b) => /CANCEL|REFUND/.test(upper(b.status)));
  const openCases = input.caseStatuses.filter((s) => OPEN_CASE_STATUSES.has(upper(s))).length;
  const ratings = input.ratings.filter((r) => Number.isFinite(r) && r > 0);

  return {
    bookings: bookings.length,
    paidBookings: paid.length,
    tripsStarted: started.length,
    pickupValidated: validated.length,
    pickupValidatedRate: pct(validated.length, started.length),
    completed: completed.length,
    travellerConfirmed: confirmed.length,
    autoCompleted: completed.length - confirmed.length,
    travellerConfirmedRate: pct(confirmed.length, completed.length),
    cancelledAfterPayment: cancelled.length,
    cancellationRate: pct(cancelled.length, paid.length),
    cases: input.caseStatuses.length,
    openCases,
    casesPer100Paid: paid.length ? round1((input.caseStatuses.length / paid.length) * 100) : null,
    payoutClaimsRejected: input.payoutStatuses.filter((s) => upper(s) === "REJECTED").length,
    medianHoursToConfirm: median(paid.map((b) => hoursBetween(b.paidAt, b.confirmedAt)).filter((h) => h >= 0)),
    medianHoursToFinish: median(completed.concat(bookings.filter((b) => upper(b.status) === "OPERATOR_COMPLETED"))
      .map((b) => hoursBetween(b.endDate, b.operatorCompletedAt)).filter((h) => Number.isFinite(h))),
    reviews: ratings.length,
    averageRating: ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 100) / 100 : null,
  };
}

const reviewScore = (r: { punctualityRating: number; customerCareRating: number; communicationRating: number }) =>
  (num(r.punctualityRating) + num(r.customerCareRating) + num(r.communicationRating)) / 3;

export class OperatorStatementNotFound extends Error {}

export async function buildOperatorStatement(
  agentId: number,
  period: { from: Date | null; to: Date | null },
  generatedBy: { id: number | null; email?: string | null },
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, userId: true, status: true, level: true, operatorProfile: true,
      areasOfOperation: true, languages: true, specializations: true, yearsOfExperience: true,
      suspendedAt: true, suspensionReason: true, restoredAt: true, createdAt: true,
      user: { select: { id: true, name: true, fullName: true, email: true, phone: true, createdAt: true, suspendedAt: true, isDisabled: true } },
    },
  });
  if (!agent) throw new OperatorStatementNotFound("Operator not found");

  const { from, to } = period;
  const range = (field: string) => {
    if (!from && !to) return {};
    return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
  };
  const inPeriod = (d: Date | null | undefined) =>
    Boolean(d) && (!from || new Date(d!).getTime() >= from.getTime()) && (!to || new Date(d!).getTime() <= to.getTime());

  const [
    bookings, packages, documents, periodReviews, lifetimeReviews, tierSetting,
    lifetimeCompleted, lifetimeRevenue, adminAudits, auditLogs,
  ] = await Promise.all([
    prisma.tourBooking.findMany({
      where: { operatorAgentId: agentId, ...range("createdAt") },
      select: {
        id: true, bookingCode: true, title: true, destination: true, startDate: true, endDate: true,
        travelerCount: true, status: true, paymentStatus: true, payoutStatus: true, currency: true,
        grossAmount: true, commissionAmount: true, operatorPayoutAmount: true, customerPaymentRef: true, paymentRef: true,
        paidAt: true, confirmedAt: true, operatorCompletedAt: true, customerConfirmedAt: true, completedAt: true,
        canceledAt: true, metadata: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // Packages are read the way the public site sells them, not from the
    // TourPackage reporting copy (lib/operatorPackages.ts).
    Promise.resolve(operatorPackageRegister(agent.operatorProfile)),
    prisma.userDocument.findMany({
      where: { userId: agent.userId },
      select: { id: true, type: true, status: true, reason: true, createdAt: true, updatedAt: true },
      orderBy: { id: "desc" },
      take: 50,
    }).catch(() => []),
    prisma.agentReview.findMany({
      where: { agentId, ...range("createdAt") },
      select: { punctualityRating: true, customerCareRating: true, communicationRating: true, comment: true, createdAt: true, tourBooking: { select: { bookingCode: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentReview.aggregate({
      where: { agentId },
      _avg: { punctualityRating: true, customerCareRating: true, communicationRating: true },
      _count: { _all: true },
    }),
    prisma.systemSetting.findUnique({ where: { id: 1 }, select: { agentTierLadder: true } as any }).catch(() => null),
    prisma.tourBooking.count({ where: { operatorAgentId: agentId, status: "COMPLETED" } }),
    prisma.tourBooking.aggregate({
      where: { operatorAgentId: agentId, OR: [{ paymentStatus: "PAID" }, { paidAt: { not: null } }] },
      _sum: { commissionAmount: true },
    }),
    prisma.adminAudit.findMany({
      where: { targetUserId: agent.userId, ...range("createdAt") },
      select: { id: true, action: true, details: true, createdAt: true, admin: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.auditLog.findMany({
      where: { entity: `agent:${agentId}`, actorRole: "ADMIN", ...range("createdAt") },
      select: { id: true, action: true, afterJson: true, createdAt: true, actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // Money and cases are keyed to EVERY booking this operator ever had: a payout
  // or a case raised this month against a booking made in March belongs in this
  // month's statement, exactly as the owner statement treats payouts.
  const allBookingIds = (await prisma.tourBooking.findMany({
    where: { operatorAgentId: agentId },
    select: { id: true },
  })).map((b) => b.id);
  const periodBookingIds = new Set(bookings.map((b) => b.id));

  const [money, cases] = allBookingIds.length
    ? await Promise.all([
        prisma.tourFinancialTransaction.findMany({
          where: { tourBookingId: { in: allBookingIds }, kind: { in: ["PAYOUT", "PAYOUT_RECOVERY", "REFUND"] } },
          select: {
            id: true, tourBookingId: true, kind: true, status: true, provider: true, reference: true,
            currency: true, amount: true, metadata: true, createdAt: true, updatedAt: true,
            booking: { select: { bookingCode: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.tourCase.findMany({
          where: { tourBookingId: { in: allBookingIds } },
          select: {
            id: true, tourBookingId: true, type: true, status: true, severity: true, title: true,
            resolution: true, resolutionAmount: true, createdAt: true, closedAt: true, withdrawnAt: true,
            booking: { select: { bookingCode: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], []];

  const touchesPeriod = (row: { tourBookingId: number; createdAt: Date; updatedAt?: Date; closedAt?: Date | null }) =>
    (!from && !to) || periodBookingIds.has(row.tourBookingId) || inPeriod(row.createdAt) || inPeriod(row.updatedAt) || inPeriod(row.closedAt);

  const payoutRows = money.filter((m) => m.kind === "PAYOUT" && touchesPeriod(m));
  const recoveryRows = money.filter((m) => m.kind === "PAYOUT_RECOVERY");
  const refundRows = money.filter((m) => m.kind === "REFUND" && touchesPeriod(m));
  const periodCases = cases.filter((c) => touchesPeriod(c));

  // Lifetime standing, computed exactly as the operator dashboard and the
  // disbursement policy do, so the statement can never disagree with them.
  const avg = lifetimeReviews._avg;
  const lifetimeRating = [avg.punctualityRating, avg.customerCareRating, avg.communicationRating].every((n) => typeof n === "number")
    ? (num(avg.punctualityRating) + num(avg.customerCareRating) + num(avg.communicationRating)) / 3
    : null;
  const tier = computeAgentLevel(
    {
      completedTours: lifetimeCompleted,
      noLSAFRevenue: Math.round(num(lifetimeRevenue._sum.commissionAmount)),
      overallRating: lifetimeRating,
      totalReviews: lifetimeReviews._count._all,
    },
    resolveTierLadder((tierSetting as any)?.agentTierLadder),
  );

  const paidBookings = bookings.filter(isPaid);
  const sales = {
    bookingCount: bookings.length,
    paidCount: paidBookings.length,
    travellers: paidBookings.reduce((s, b) => s + num(b.travelerCount), 0),
    gross: paidBookings.reduce((s, b) => s + num(b.grossAmount), 0),
    commission: paidBookings.reduce((s, b) => s + num(b.commissionAmount), 0),
    operatorNet: paidBookings.reduce((s, b) => s + num(b.operatorPayoutAmount), 0),
    /**
     * Trips that started or finished with no payment recorded. A real trip
     * cannot start before payment, so this is a data problem to look at
     * (test data, or a payment recorded outside the system), never earnings.
     */
    startedWithoutPayment: bookings.filter((b) => STARTED_STATUSES.has(upper(b.status)) && !isPaid(b)).length,
  };

  const sumOf = (rows: typeof money) => rows.reduce((s, r) => s + num(r.amount), 0);
  const advances = payoutRows.filter((r) => isAdvanceRow(r.metadata));
  const balances = payoutRows.filter((r) => !isAdvanceRow(r.metadata));
  const paidOf = (rows: typeof money) => rows.filter((r) => PAYOUT_PAID.has(upper(r.status)));
  const payouts = {
    count: payoutRows.length,
    advancePaid: sumOf(paidOf(advances)),
    advancePaidCount: paidOf(advances).length,
    balancePaid: sumOf(paidOf(balances)),
    balancePaidCount: paidOf(balances).length,
    inFlight: sumOf(payoutRows.filter((r) => PAYOUT_IN_FLIGHT.has(upper(r.status)))),
    inFlightCount: payoutRows.filter((r) => PAYOUT_IN_FLIGHT.has(upper(r.status))).length,
    rejectedCount: payoutRows.filter((r) => upper(r.status) === "REJECTED").length,
  };

  const recovery = {
    // Lifetime, not period: a debt does not stop being owed at a date boundary.
    outstanding: recoveryRows
      .filter((r) => upper(r.status) === "PENDING")
      .reduce((s, r) => s + Math.max(0, num(r.amount) - offsetAppliedOf(r.metadata)), 0),
    pendingCount: recoveryRows.filter((r) => upper(r.status) === "PENDING").length,
    recovered: sumOf(recoveryRows.filter((r) => upper(r.status) === "RECOVERED")),
    refundedToTravellers: sumOf(refundRows.filter((r) => ["PAID", "COMPLETED", "SUCCEEDED", "REFUNDED"].includes(upper(r.status)))),
  };

  const behaviour = operatorBehaviour({
    bookings,
    caseStatuses: periodCases.map((c) => c.status),
    payoutStatuses: payoutRows.map((r) => r.status),
    ratings: periodReviews.map(reviewScore),
  });

  const profile = agent.operatorProfile && typeof agent.operatorProfile === "object" ? (agent.operatorProfile as Record<string, any>) : {};
  const contract = readContractWorkflow(agent.operatorProfile);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

  const generatedByUser = generatedBy.id
    ? await prisma.user.findUnique({ where: { id: generatedBy.id }, select: { id: true, name: true, email: true } }).catch(() => null)
    : null;
  const generatedAt = new Date();

  const adminActions = [
    ...adminAudits.map((a) => ({
      id: `aa-${a.id}`, action: a.action, details: a.details ?? null, createdAt: iso(a.createdAt),
      adminName: a.admin?.name ?? a.admin?.email ?? null,
    })),
    ...auditLogs.map((a) => ({
      id: `al-${String(a.id)}`, action: a.action, details: a.afterJson ?? null, createdAt: iso(a.createdAt),
      adminName: a.actor?.name ?? a.actor?.email ?? null,
    })),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    generatedAt: generatedAt.toISOString(),
    generatedBy: {
      id: generatedByUser?.id ?? generatedBy.id,
      name: generatedByUser?.name ?? null,
      email: generatedByUser?.email ?? generatedBy.email ?? null,
    },
    period: { from: iso(from), to: iso(to) },
    coverage: { from: iso(from ?? agent.createdAt), to: iso(to ?? generatedAt) },
    operator: {
      id: agent.id,
      userId: agent.userId,
      companyName: typeof profile.companyName === "string" && profile.companyName.trim() ? profile.companyName.trim() : null,
      contactName: agent.user?.fullName?.trim() || agent.user?.name?.trim() || null,
      email: agent.user?.email ?? null,
      phone: agent.user?.phone ?? null,
      status: agent.status,
      storedLevel: agent.level,
      areas: list(agent.areasOfOperation),
      languages: list(agent.languages),
      specializations: list(agent.specializations),
      yearsOfExperience: agent.yearsOfExperience ?? null,
      joinedAt: iso(agent.createdAt),
      suspendedAt: iso(agent.suspendedAt),
      suspensionReason: agent.suspensionReason ?? null,
      restoredAt: iso(agent.restoredAt),
      accountDisabled: Boolean(agent.user?.isDisabled),
    },
    contract: contract
      ? {
          contractId: contract.contractId, version: contract.version, status: contract.status,
          effectiveDate: contract.effectiveDate || null, nolsafSignedAt: contract.nolsafSignedAt ?? null,
          agentSignedAt: contract.agentSignedAt ?? null, agentSignerName: contract.agentSignerName ?? null,
        }
      : null,
    documents: documents.map((d: any) => ({ id: d.id, type: d.type, status: d.status, reason: d.reason ?? null, uploadedAt: iso(d.createdAt), reviewedAt: iso(d.updatedAt) })),
    tier: {
      live: tier.level,
      stored: agent.level,
      completedTours: tier.completedTours,
      noLSAFRevenue: tier.noLSAFRevenue,
      overallRating: tier.overallRating != null ? Math.round(tier.overallRating * 100) / 100 : null,
      totalReviews: tier.totalReviews,
      next: tier.next,
    },
    packagesApproved: { profileApproved: packages.profileApproved, underReview: packages.underReview, approvedAt: packages.approvedAt },
    packages: packages.packages.map((p) => ({
      key: p.key, name: p.name, destination: p.destination, category: p.category, state: p.state,
      currency: p.currency, pricePerPerson: p.pricePerPerson, problems: p.problems, removedAt: p.removedAt,
    })),
    sales,
    bookings: bookings.map((b) => ({
      id: b.id, bookingCode: b.bookingCode, title: b.title, destination: b.destination,
      startDate: iso(b.startDate), endDate: iso(b.endDate), travellers: b.travelerCount,
      status: b.status, paymentStatus: b.paymentStatus, payoutStatus: b.payoutStatus, currency: b.currency,
      gross: num(b.grossAmount), commission: num(b.commissionAmount), operatorNet: num(b.operatorPayoutAmount),
      paymentRef: b.customerPaymentRef || b.paymentRef || null, paidAt: iso(b.paidAt),
      pickupValidated: pickupValidated(b.metadata), travellerConfirmed: Boolean(b.customerConfirmedAt),
      createdAt: iso(b.createdAt),
    })),
    payouts,
    payoutRegister: payoutRows.map((r) => ({
      id: r.id, bookingCode: r.booking?.bookingCode ?? null, tranche: isAdvanceRow(r.metadata) ? "ADVANCE" : "BALANCE",
      status: r.status, provider: r.provider, reference: r.reference, currency: r.currency, amount: num(r.amount),
      raisedAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
      reason: typeof (r.metadata as any)?.rejectionReason === "string" ? (r.metadata as any).rejectionReason
        : typeof (r.metadata as any)?.reason === "string" ? (r.metadata as any).reason : null,
    })),
    recovery,
    recoveryRegister: recoveryRows.map((r) => ({
      id: r.id, bookingCode: r.booking?.bookingCode ?? null, status: r.status, currency: r.currency,
      amount: num(r.amount), offsetApplied: offsetAppliedOf(r.metadata),
      outstanding: upper(r.status) === "PENDING" ? Math.max(0, num(r.amount) - offsetAppliedOf(r.metadata)) : 0,
      raisedAt: iso(r.createdAt),
    })),
    cases: periodCases.map((c) => ({
      id: c.id, bookingCode: c.booking?.bookingCode ?? null, type: c.type, status: c.status, severity: c.severity,
      title: c.title, resolution: c.resolution ?? null, resolutionAmount: c.resolutionAmount != null ? num(c.resolutionAmount) : null,
      openedAt: iso(c.createdAt), closedAt: iso(c.closedAt ?? c.withdrawnAt),
    })),
    behaviour,
    reviews: periodReviews.slice(0, 200).map((r) => ({
      bookingCode: r.tourBooking?.bookingCode ?? null,
      score: Math.round(reviewScore(r) * 100) / 100,
      punctuality: r.punctualityRating, customerCare: r.customerCareRating, communication: r.communicationRating,
      comment: r.comment ?? null, createdAt: iso(r.createdAt),
    })),
    adminActions,
  };
}

export type OperatorStatement = Awaited<ReturnType<typeof buildOperatorStatement>>;
