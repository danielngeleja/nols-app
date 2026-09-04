// apps/api/src/lib/customerStatement.ts
//
// Everything one customer has done on NoLSAF, assembled for a printable
// statement. Built for the case where a customer disputes a charge or asks
// what they have been billed for, so every money line is traceable back to the
// record it came from.
//
// Deliberately mirrors admin.owners' statement helpers: read-only, never
// throws, and the summary totals are computed from the same rows the document
// lists so the two can never disagree.

export type CustomerStatementRange = { from: Date | null; to: Date | null };

export type ServiceLine = {
  key: "stays" | "tours" | "transport" | "groups";
  label: string;
  /** Records created in the period, whatever their status. */
  records: number;
  /** Records that reached a paid or completed state. */
  paidRecords: number;
  /** Value of those paid records. */
  paidAmount: number;
  /** Records cancelled in the period. */
  canceled: number;
  currency: string;
};

/** Statuses that mean the customer actually parted with money. */
const PAID_STATES: Record<ServiceLine["key"], string[]> = {
  stays: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"],
  tours: ["PAID", "CONFIRMED", "COMPLETED"],
  transport: ["CONFIRMED", "ASSIGNED", "IN_PROGRESS", "COMPLETED"],
  groups: ["CONFIRMED", "PAID", "COMPLETED"],
};

const CANCELED_STATES = ["CANCELED", "CANCELLED", "REFUNDED", "REJECTED"];

const num = (v: any) => Number(v ?? 0);
const iso = (d: any) => (d ? new Date(d).toISOString() : null);

function inRange(range: CustomerStatementRange, field: string) {
  if (!range.from && !range.to) return {};
  const clause: any = {};
  if (range.from) clause.gte = range.from;
  if (range.to) clause.lte = range.to;
  return { [field]: clause };
}

export type CustomerStatementData = {
  services: ServiceLine[];
  totals: { records: number; paidRecords: number; paidAmount: number; canceled: number; currency: string };
  /** Session-derived usage. The platform records sign-ins, not page views. */
  usage: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    sessions: number;
    activeSessions: number;
    /** Summed (lastSeenAt - createdAt) across sessions, in minutes. */
    engagedMinutes: number;
    /** Distinct calendar days on which a session was active. */
    activeDays: number;
    /** Days between first and last recorded activity. */
    relationshipDays: number;
    basis: string;
  };
  /** Money owed back to the customer, and whether it actually reached them.
   *  In a dispute this is usually the first question asked. */
  refunds: {
    requested: number;
    approvedAmount: number;
    refundedAmount: number;
    refundedCount: number;
    /** Approved but not yet marked as refunded. */
    outstandingAmount: number;
    outstandingCount: number;
    entries: {
      id: number;
      bookingCode: string;
      status: string;
      amount: number;
      provider: string | null;
      reference: string | null;
      requestedAt: string | null;
      approvedAt: string | null;
      refundedAt: string | null;
      policyRule: string | null;
      policyRefundPercent: number | null;
    }[];
  };
  /** Individual records, newest first, for the printed registers. */
  entries: {
    key: ServiceLine["key"];
    service: string;
    reference: string;
    description: string;
    status: string;
    amount: number;
    currency: string;
    createdAt: string | null;
    paidAt: string | null;
  }[];
};

/**
 * Assembles one customer's service usage and spend. Never throws: a statement
 * that is missing one stream is better than a page that will not load.
 */
export async function buildCustomerStatement(
  db: any,
  userId: number,
  range: CustomerStatementRange,
): Promise<CustomerStatementData> {
  const empty: CustomerStatementData = {
    services: [],
    totals: { records: 0, paidRecords: 0, paidAmount: 0, canceled: 0, currency: "TZS" },
    usage: {
      firstSeenAt: null, lastSeenAt: null, sessions: 0, activeSessions: 0,
      engagedMinutes: 0, activeDays: 0, relationshipDays: 0,
      basis: "No session records available.",
    },
    refunds: {
      requested: 0, approvedAmount: 0, refundedAmount: 0, refundedCount: 0,
      outstandingAmount: 0, outstandingCount: 0, entries: [],
    },
    entries: [],
  };

  try {
    const [stays, tours, transport, groups, sessions, cancellations] = await Promise.all([
      db.booking.findMany({
        where: { userId, ...inRange(range, "createdAt") },
        select: {
          id: true, status: true, totalAmount: true, createdAt: true,
          property: { select: { title: true } },
        },
        orderBy: { id: "desc" },
      }).catch(() => []),
      db.tourBooking.findMany({
        where: { customerId: userId, ...inRange(range, "createdAt") },
        select: {
          id: true, status: true, grossAmount: true, currency: true,
          createdAt: true, paidAt: true, title: true,
        },
        orderBy: { id: "desc" },
      }).catch(() => []),
      db.transportBooking.findMany({
        where: { userId, ...inRange(range, "createdAt") },
        select: { id: true, status: true, amount: true, currency: true, createdAt: true },
        orderBy: { id: "desc" },
      }).catch(() => []),
      db.groupBooking.findMany({
        where: { userId, ...inRange(range, "createdAt") },
        select: { id: true, status: true, totalAmount: true, currency: true, createdAt: true },
        orderBy: { id: "desc" },
      }).catch(() => []),
      db.session.findMany({
        where: { userId },
        select: { createdAt: true, lastSeenAt: true, revokedAt: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => []),
      db.cancellationRequest.findMany({
        where: { userId, ...inRange(range, "createdAt") },
        select: {
          id: true, bookingCode: true, status: true,
          refundAmount: true, refundProvider: true, refundReference: true,
          refundInitiatedAt: true, refundedAt: true,
          approvedAt: true, createdAt: true,
          policyRule: true, policyRefundPercent: true,
        },
        orderBy: { id: "desc" },
      }).catch(() => []),
    ]);

    const upper = (v: any) => String(v ?? "").toUpperCase();
    const isPaid = (key: ServiceLine["key"], status: any) => PAID_STATES[key].includes(upper(status));
    const isCanceled = (status: any) => CANCELED_STATES.includes(upper(status));

    const line = (
      key: ServiceLine["key"],
      label: string,
      rows: any[],
      amountOf: (row: any) => number,
      currencyOf: (row: any) => string,
    ): ServiceLine => {
      const paid = rows.filter(r => isPaid(key, r.status));
      return {
        key,
        label,
        records: rows.length,
        paidRecords: paid.length,
        paidAmount: paid.reduce((sum, r) => sum + amountOf(r), 0),
        canceled: rows.filter(r => isCanceled(r.status)).length,
        currency: rows.length ? currencyOf(rows[0]) : "TZS",
      };
    };

    const services: ServiceLine[] = [
      line("stays", "Accommodation", stays, r => num(r.totalAmount), () => "TZS"),
      line("tours", "Tours", tours, r => num(r.grossAmount), r => String(r.currency || "TZS")),
      line("transport", "Transport", transport, r => num(r.amount), r => String(r.currency || "TZS")),
      line("groups", "Group stays", groups, r => num(r.totalAmount), r => String(r.currency || "TZS")),
    ];

    // Tours may be priced in a foreign currency. Mixing currencies into one
    // total would be a lie, so the headline total covers TZS lines only and
    // the per-service table carries the rest.
    const tzsServices = services.filter(s => s.currency === "TZS");
    const totals = {
      records: services.reduce((sum, s) => sum + s.records, 0),
      paidRecords: services.reduce((sum, s) => sum + s.paidRecords, 0),
      paidAmount: tzsServices.reduce((sum, s) => sum + s.paidAmount, 0),
      canceled: services.reduce((sum, s) => sum + s.canceled, 0),
      currency: "TZS",
    };

    // ── Usage ──
    // NoLSAF records sign-ins and last-seen timestamps, not page views, so
    // "time on platform" here is the sum of each session's own window. It is a
    // floor, not a measurement of attention, and the statement says so.
    let engagedMs = 0;
    const activeDayKeys = new Set<string>();
    for (const s of sessions as any[]) {
      const start = new Date(s.createdAt).getTime();
      const end = new Date(s.lastSeenAt ?? s.createdAt).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) engagedMs += end - start;
      if (Number.isFinite(start)) activeDayKeys.add(new Date(s.createdAt).toISOString().slice(0, 10));
    }
    const firstSeen = (sessions as any[])[0]?.createdAt ?? null;
    const lastSeen = (sessions as any[]).reduce((latest: any, s: any) => {
      const value = s.lastSeenAt ?? s.createdAt;
      return !latest || new Date(value) > new Date(latest) ? value : latest;
    }, null as any);

    const usage = {
      firstSeenAt: iso(firstSeen),
      lastSeenAt: iso(lastSeen),
      sessions: sessions.length,
      activeSessions: (sessions as any[]).filter(s => !s.revokedAt).length,
      engagedMinutes: Math.round(engagedMs / 60000),
      activeDays: activeDayKeys.size,
      relationshipDays: firstSeen && lastSeen
        ? Math.max(0, Math.round((new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / 86400000))
        : 0,
      basis:
        "Summed from session windows: sign-in to last recorded activity. NoLSAF does not record page views, "
        + "so this is a lower bound on time spent, not a measure of attention.",
    };

    // ── Refunds ──
    // Approved is what was agreed; refunded is what actually left NoLSAF. The
    // gap between the two is the number a disputing customer is calling about,
    // so it is reported on its own rather than folded into either.
    const refundEntries = (cancellations as any[]).map(r => ({
      id: r.id,
      bookingCode: String(r.bookingCode ?? ""),
      status: upper(r.status),
      amount: num(r.refundAmount),
      provider: r.refundProvider ?? null,
      reference: r.refundReference ?? null,
      requestedAt: iso(r.createdAt),
      approvedAt: iso(r.approvedAt),
      refundedAt: iso(r.refundedAt),
      policyRule: r.policyRule ?? null,
      policyRefundPercent: r.policyRefundPercent ?? null,
    }));

    const settledRefunds = refundEntries.filter(r => r.refundedAt !== null);
    const approvedRefunds = refundEntries.filter(r => r.approvedAt !== null);
    const outstandingRefunds = approvedRefunds.filter(r => r.refundedAt === null);

    const refunds = {
      requested: refundEntries.length,
      approvedAmount: approvedRefunds.reduce((sum, r) => sum + r.amount, 0),
      refundedAmount: settledRefunds.reduce((sum, r) => sum + r.amount, 0),
      refundedCount: settledRefunds.length,
      outstandingAmount: outstandingRefunds.reduce((sum, r) => sum + r.amount, 0),
      outstandingCount: outstandingRefunds.length,
      entries: refundEntries,
    };

    // ── Line entries for the printed registers ──
    const entries: CustomerStatementData["entries"] = [
      ...(stays as any[]).map(r => ({
        key: "stays" as const,
        service: "Accommodation",
        reference: `BK-${r.id}`,
        description: r.property?.title ?? "Property not recorded",
        status: upper(r.status),
        amount: num(r.totalAmount),
        currency: "TZS",
        createdAt: iso(r.createdAt),
        paidAt: null,
      })),
      ...(tours as any[]).map(r => ({
        key: "tours" as const,
        service: "Tour",
        reference: `TB-${r.id}`,
        description: r.title ?? "Package not recorded",
        status: upper(r.status),
        amount: num(r.grossAmount),
        currency: String(r.currency || "TZS"),
        createdAt: iso(r.createdAt),
        paidAt: iso(r.paidAt),
      })),
      ...(transport as any[]).map(r => ({
        key: "transport" as const,
        service: "Transport",
        reference: `TR-${r.id}`,
        description: "Transport booking",
        status: upper(r.status),
        amount: num(r.amount),
        currency: String(r.currency || "TZS"),
        createdAt: iso(r.createdAt),
        paidAt: null,
      })),
      ...(groups as any[]).map(r => ({
        key: "groups" as const,
        service: "Group stay",
        reference: `GB-${r.id}`,
        description: "Group stay booking",
        status: upper(r.status),
        amount: num(r.totalAmount),
        currency: String(r.currency || "TZS"),
        createdAt: iso(r.createdAt),
        paidAt: null,
      })),
    ].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

    return { services, totals, usage, refunds, entries };
  } catch (err: any) {
    console.warn("Failed to build customer statement:", err?.message);
    return empty;
  }
}
