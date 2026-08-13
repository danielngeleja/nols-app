/**
 * Disbursement reporting — the finance export behind /admin/disbursements/reports
 *
 * One filter shape drives three things, so the preview an admin approves on
 * screen and the CSV they hand to finance can never describe different rows:
 * buildReportWhere() is shared by the row query, the summary, and the export.
 *
 * The CSV mirrors the layout of AzamPay/Airtel's own bulk disbursement report
 * (record + batch identity, both sides' references, split payment date/time,
 * operator, amount, response message, remarks) so a NoLSAF export can be read
 * beside a provider statement without re-mapping columns by hand. Where the
 * provider report carries fields NoLSAF genuinely does not hold (KYC name and
 * status, service charge, post balance, institution id) the columns are not
 * emitted as empty decoration: they are replaced by what NoLSAF does know
 * about the destination, which is whether Name Lookup verified it and when.
 *
 * Nothing here writes. This module reads and formats.
 */

import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";

export const REPORT_SOURCE_TYPES = ["OWNER_INVOICE", "TOUR_BOOKING", "DRIVER_TRIP", "SALES_PAYOUT"] as const;
export type ReportSourceType = (typeof REPORT_SOURCE_TYPES)[number];

/**
 * The groups an admin actually thinks in. "Filter all owners" and "filter this
 * one owner" are different questions, so groups and a single recipient are
 * separate filters rather than one overloaded field.
 */
export const REPORT_GROUPS = ["OWNERS", "TOURS", "DRIVERS", "SALES"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const GROUP_TO_SOURCE_TYPE: Record<ReportGroup, ReportSourceType> = {
  OWNERS: "OWNER_INVOICE",
  TOURS: "TOUR_BOOKING",
  DRIVERS: "DRIVER_TRIP",
  SALES: "SALES_PAYOUT",
};

export const DESTINATION_TYPES = ["MOBILE_MONEY", "BANK"] as const;

const DESTINATION_TYPE_LABEL: Record<string, string> = {
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank",
};

const SOURCE_TYPE_TO_GROUP_LABEL: Record<string, string> = {
  OWNER_INVOICE: "Owner",
  TOUR_BOOKING: "Tour",
  DRIVER_TRIP: "Driver",
  SALES_PAYOUT: "Sales",
};

/** Which timestamp the date range applies to. A payout report keyed on the wrong date lands rows in the wrong week. */
export const REPORT_DATE_FIELDS = ["createdAt", "approvedAt", "paidAt"] as const;
export type ReportDateField = (typeof REPORT_DATE_FIELDS)[number];

/**
 * Minutes that `timeZone` is ahead of UTC at `date`, read from Intl rather
 * than hardcoded, so this keeps working if reporting is ever pointed at a zone
 * that observes DST.
 */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Turns a calendar day an admin typed into the exact instant that day starts
 * or ends **in the reporting timezone**. Parsing "2026-08-01" as UTC would put
 * every Tanzanian payout made before 03:00 local into the previous day, which
 * is how a report silently disagrees with the provider statement it is meant
 * to be reconciled against. A full ISO timestamp is passed through as given.
 */
export function parseReportDate(value: string, edge: "start" | "end"): Date {
  if (value.length > 10) return new Date(value);
  const [year, month, day] = value.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, edge === "end" ? 23 : 0, edge === "end" ? 59 : 0, edge === "end" ? 59 : 0, edge === "end" ? 999 : 0);
  // Rounded: the formatter behind zoneOffsetMinutes only resolves to the
  // second, so an end-of-day instant's .999 would otherwise leak into the
  // offset and shift the boundary by a millisecond. Real zone offsets are
  // whole minutes.
  const offset = Math.round(zoneOffsetMinutes(new Date(wallClock), reportTimeZone()));
  return new Date(wallClock - offset * 60000);
}

export interface ReportFilters {
  from?: Date;
  to?: Date;
  dateField: ReportDateField;
  /** Empty means every group. */
  groups: ReportGroup[];
  /** A specific beneficiary: the User who owns the payout account money lands in. */
  recipientUserId?: number;
  payoutAccountId?: number;
  statuses: string[];
  currency?: string;
  /**
   * The institution money lands at, as stored on the disbursement. Copied from
   * PayoutAccount.provider at request time, so it is an MNO for mobile money
   * (airtel | tigo | azampesa) and a bank for bank destinations (crdb | nmb |
   * ...). Not MNO-only, despite the column's name.
   */
  bankName?: string;
  /** MOBILE_MONEY | BANK. Kept separate from the provider so "every bank payout" is one filter rather than a list of bank names. */
  destinationType?: string;
  batchReference?: string;
  q?: string;
}

/**
 * A report over a date field that is NULL for unfinished payouts silently
 * drops them. Asking for "paid in July" and getting only paid rows is correct;
 * asking for "created in July" must not be answered with paid rows only. So
 * the date field is part of the filter and is echoed back to the caller.
 */
export function buildReportWhere(filters: ReportFilters): Prisma.DisbursementWhereInput {
  const range: Prisma.DateTimeNullableFilter | Prisma.DateTimeFilter = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
  const hasRange = filters.from !== undefined || filters.to !== undefined;

  const sourceTypes = filters.groups.map((group) => GROUP_TO_SOURCE_TYPE[group]);

  // Both the beneficiary and the destination type live on the payout account,
  // so they have to be merged into one relation filter. Two separate
  // `payoutAccount` keys in the same object would silently drop the first.
  const account = {
    ...(filters.recipientUserId ? { userId: filters.recipientUserId } : {}),
    ...(filters.destinationType ? { type: filters.destinationType } : {}),
  };

  return {
    ...(hasRange ? { [filters.dateField]: range } : {}),
    ...(sourceTypes.length ? { sourceType: { in: sourceTypes } } : {}),
    ...(filters.statuses.length ? { status: { in: filters.statuses } } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.bankName ? { bankName: filters.bankName } : {}),
    ...(filters.payoutAccountId ? { payoutAccountId: filters.payoutAccountId } : {}),
    ...(Object.keys(account).length ? { payoutAccount: { is: account } } : {}),
    ...(filters.batchReference ? { batch: { is: { batchReference: filters.batchReference } } } : {}),
    // MySQL collations are case-insensitive already, so plain `contains` matches either case.
    ...(filters.q
      ? {
          OR: [
            { externalReferenceId: { contains: filters.q } },
            { pgReferenceId: { contains: filters.q } },
            { fspReferenceId: { contains: filters.q } },
            { remarks: { contains: filters.q } },
            { payoutAccount: { is: { accountName: { contains: filters.q } } } },
            { payoutAccount: { is: { accountNumber: { contains: filters.q } } } },
          ],
        }
      : {}),
  } as Prisma.DisbursementWhereInput;
}

const ROW_INCLUDE = {
  payoutAccount: {
    select: {
      id: true,
      userId: true,
      type: true,
      provider: true,
      accountNumber: true,
      accountName: true,
      isVerified: true,
      lastVerifiedAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  batch: { select: { id: true, batchReference: true, status: true, authorizedAt: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DisbursementInclude;

export type ReportRow = Prisma.DisbursementGetPayload<{ include: typeof ROW_INCLUDE }>;

export async function loadReportRows(
  filters: ReportFilters,
  paging: { skip: number; take: number }
): Promise<ReportRow[]> {
  return prisma.disbursement.findMany({
    where: buildReportWhere(filters),
    include: ROW_INCLUDE,
    // Newest first matches every other list in the workspace. The CSV is
    // re-sorted oldest first at write time, because a statement reads forward.
    orderBy: [{ [filters.dateField]: "desc" } as Prisma.DisbursementOrderByWithRelationInput, { id: "desc" }],
    skip: paging.skip,
    take: paging.take,
  });
}

export interface ReportSummary {
  rows: number;
  recipients: number;
  /** Totals are per currency. A single figure across currencies is a meaningless number to hand finance. */
  totals: Array<{ currency: string; count: number; amount: string }>;
  byStatus: Array<{ status: string; count: number; amount: string }>;
  byGroup: Array<{ sourceType: string; label: string; count: number; amount: string }>;
  /**
   * Institutions actually present in this selection, mobile money and bank
   * alike. The UI builds its destination filter from this rather than from a
   * hardcoded list of MNOs, which is how bank payouts became unreachable from
   * the filter in the first place.
   */
  byDestination: Array<{ bankName: string; count: number; amount: string }>;
}

export async function loadReportSummary(filters: ReportFilters): Promise<ReportSummary> {
  const where = buildReportWhere(filters);

  const [byCurrency, byStatus, byGroup, byDestination, recipients] = await Promise.all([
    prisma.disbursement.groupBy({ by: ["currency"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.disbursement.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.disbursement.groupBy({ by: ["sourceType"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.disbursement.groupBy({ by: ["bankName"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.disbursement.findMany({ where, select: { payoutAccountId: true }, distinct: ["payoutAccountId"] }),
  ]);

  const amount = (value: Prisma.Decimal | null) => (value ?? new Prisma.Decimal(0)).toString();

  return {
    rows: byCurrency.reduce((sum, entry) => sum + entry._count._all, 0),
    recipients: recipients.length,
    totals: byCurrency
      .map((entry) => ({ currency: entry.currency, count: entry._count._all, amount: amount(entry._sum.amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    byStatus: byStatus
      .map((entry) => ({ status: entry.status, count: entry._count._all, amount: amount(entry._sum.amount) }))
      .sort((a, b) => b.count - a.count),
    byGroup: byGroup
      .map((entry) => ({
        sourceType: entry.sourceType,
        label: SOURCE_TYPE_TO_GROUP_LABEL[entry.sourceType] ?? entry.sourceType,
        count: entry._count._all,
        amount: amount(entry._sum.amount),
      }))
      .sort((a, b) => b.count - a.count),
    byDestination: byDestination
      .map((entry) => ({ bankName: entry.bankName, count: entry._count._all, amount: amount(entry._sum.amount) }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function countReportRows(filters: ReportFilters): Promise<number> {
  return prisma.disbursement.count({ where: buildReportWhere(filters) });
}

/**
 * Beneficiaries that actually appear in the filtered set, for the "one
 * specific owner / tour / driver / sales person" picker. Derived from the
 * disbursements themselves rather than from the user tables, so the picker can
 * never offer someone who has no payout in scope.
 */
export async function loadReportRecipients(
  filters: ReportFilters,
  q: string | undefined,
  limit = 50
): Promise<Array<{ userId: number; name: string; accountName: string; group: string; count: number; amount: string }>> {
  // The recipient filter itself is excluded here: the picker lists everyone
  // available under the current scope, not just the one already chosen.
  const scope = buildReportWhere({ ...filters, recipientUserId: undefined, payoutAccountId: undefined });

  const grouped = await prisma.disbursement.groupBy({
    by: ["payoutAccountId", "sourceType"],
    where: scope,
    _count: { _all: true },
    _sum: { amount: true },
  });
  if (grouped.length === 0) return [];

  const accountWhere: Prisma.PayoutAccountWhereInput = {
    id: { in: grouped.map((entry) => entry.payoutAccountId) },
    ...(q ? { OR: [{ accountName: { contains: q } }, { user: { is: { name: { contains: q } } } }] } : {}),
  };
  type RecipientAccount = { id: number; userId: number; accountName: string; user: { name: string | null; email: string | null } | null };
  const accounts: RecipientAccount[] = await prisma.payoutAccount.findMany({
    where: accountWhere,
    select: { id: true, userId: true, accountName: true, user: { select: { name: true, email: true } } },
  });
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));

  const byUser = new Map<number, { userId: number; name: string; accountName: string; group: string; count: number; amount: Prisma.Decimal }>();
  for (const entry of grouped) {
    const account = accountById.get(entry.payoutAccountId);
    if (!account) continue;
    const existing = byUser.get(account.userId);
    const label = SOURCE_TYPE_TO_GROUP_LABEL[entry.sourceType] ?? entry.sourceType;
    if (existing) {
      existing.count += entry._count._all;
      existing.amount = existing.amount.plus(entry._sum.amount ?? 0);
      if (!existing.group.includes(label)) existing.group = `${existing.group}, ${label}`;
      continue;
    }
    byUser.set(account.userId, {
      userId: account.userId,
      name: account.user?.name || account.user?.email || account.accountName,
      accountName: account.accountName,
      group: label,
      count: entry._count._all,
      amount: new Prisma.Decimal(entry._sum.amount ?? 0),
    });
  }

  return [...byUser.values()]
    .sort((a, b) => (b.amount.greaterThan(a.amount) ? 1 : b.amount.lessThan(a.amount) ? -1 : 0))
    .slice(0, limit)
    .map((entry) => ({ ...entry, amount: entry.amount.toString() }));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Every cell is quoted, matching the provider's own export. Beyond escaping,
 * this keeps a long account number from being re-read as a number and losing
 * its leading digits when the file is opened in a spreadsheet.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

const reportTimeZone = () => process.env.REPORT_TIMEZONE || "Africa/Dar_es_Salaam";

/**
 * d/m/yyyy and HH:mm:ss in the reporting timezone, composed from parts rather
 * than from a locale format string. The provider's own export uses this shape,
 * and a locale-dependent format would quietly change with the ICU build the
 * server happens to ship.
 */
function splitDateTime(value: Date | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: reportTimeZone(),
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  return {
    date: `${Number(parts.day)}/${Number(parts.month)}/${parts.year}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function stamp(value: Date | null): string {
  if (!value) return "";
  const { date, time } = splitDateTime(value);
  return `${date} ${time}`;
}

/**
 * Destinations are masked in list views because a whole-population dump of
 * partner account numbers is an enumeration oracle. A reconciliation export is
 * the one place the full number is the point: without it the file cannot be
 * matched line by line against the provider statement. So the caller decides,
 * the decision is gated on finance re-auth at the route, and it is recorded in
 * the admin audit.
 */
function destination(accountNumber: string, unmasked: boolean): string {
  if (unmasked) return accountNumber;
  const value = String(accountNumber ?? "");
  if (value.length <= 4) return "•".repeat(value.length);
  return `${"•".repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

export const REPORT_CSV_COLUMNS = [
  "ROW NUMBER",
  "RECORD ID",
  "BATCH ID",
  "BATCH STATUS",
  "RECORD STATUS",
  "SENDER ID",
  // Not "RECEIVER MOBILE NUMBER": a payout account is MOBILE_MONEY or BANK,
  // so this column carries a bank account number as readily as an MSISDN. The
  // DESTINATION TYPE column beside it says which one a row is, and OPERATOR
  // CODE names the institution.
  "DESTINATION TYPE",
  "RECEIVER ACCOUNT NUMBER",
  "RECEIVER NAME",
  "DESTINATION VERIFIED",
  "LAST VERIFIED",
  "RECIPIENT GROUP",
  "RECIPIENT",
  "RECIPIENT ID",
  "SOURCE TYPE",
  "SOURCE ID",
  "TRANSACTION ID",
  "EXTERNAL TRANSACTION ID",
  "FSP REFERENCE ID",
  "DATE OF PAYMENT",
  "TIME OF PAYMENT",
  "OPERATOR",
  "OPERATOR CODE",
  "AMOUNT",
  "CURRENCY",
  "RESPONSE MESSAGE",
  "REQUESTED AT",
  "APPROVED AT",
  "APPROVED BY",
  "RISK LEVEL",
  "REMARKS",
] as const;

export interface CsvOptions {
  /** Falls back into REMARKS for rows that carry none of their own, the way a provider batch narrative does. */
  label?: string;
  unmasked: boolean;
}

export function toReportCsv(rows: ReportRow[], options: CsvOptions): string {
  const senderId = String(process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT || "").trim();

  // Oldest first: a statement reads forward in time, and row numbers are only
  // meaningful against a stable order.
  const ordered = [...rows].reverse();

  const lines = [REPORT_CSV_COLUMNS.map(cell).join(",")];
  ordered.forEach((row, index) => {
    const paid = splitDateTime(row.paidAt);
    lines.push(
      [
        index + 1,
        row.externalReferenceId,
        row.batch?.batchReference ?? "",
        row.batch?.status ?? "",
        row.status,
        senderId,
        DESTINATION_TYPE_LABEL[row.payoutAccount.type] ?? row.payoutAccount.type,
        destination(row.payoutAccount.accountNumber, options.unmasked),
        row.payoutAccount.accountName,
        row.payoutAccount.isVerified ? "Verified" : "Not verified",
        stamp(row.payoutAccount.lastVerifiedAt),
        SOURCE_TYPE_TO_GROUP_LABEL[row.sourceType] ?? row.sourceType,
        row.payoutAccount.user?.name || row.payoutAccount.user?.email || "",
        row.payoutAccount.userId,
        row.sourceType,
        row.sourceId,
        row.pgReferenceId ?? "",
        row.externalReferenceId,
        row.fspReferenceId ?? "",
        paid.date,
        paid.time,
        row.operator ?? "",
        row.bankName,
        row.amount.toString(),
        row.currency,
        row.providerMessage ?? "",
        stamp(row.createdAt),
        stamp(row.approvedAt),
        row.approvedBy?.name || row.approvedBy?.email || "",
        row.riskLevel ?? "",
        row.remarks || options.label || "",
      ].map(cell).join(",")
    );
  });

  return lines.join("\r\n");
}

/**
 * A filename an operator can file without renaming: scope, date range and the
 * day it was pulled. Mirrors the provider's habit of naming the file after the
 * batch it describes.
 */
export function reportFileName(filters: ReportFilters): string {
  const scope = filters.groups.length === 1 ? filters.groups[0].toLowerCase() : filters.groups.length ? "mixed" : "all";
  const part = (value?: Date) => (value ? value.toISOString().slice(0, 10) : "");
  const range = filters.from || filters.to ? `_${part(filters.from) || "start"}_${part(filters.to) || "today"}` : "";
  return `NoLSAF_Disbursement_${scope}${range}_${new Date().toISOString().slice(0, 10)}.csv`;
}
