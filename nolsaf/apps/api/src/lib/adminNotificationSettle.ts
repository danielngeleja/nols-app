// apps/api/src/lib/adminNotificationSettle.ts
//
// Closes an admin alert by itself once the thing it asked about has been
// decided elsewhere, so the inbox never shows "Property submitted for review"
// for a property that was approved weeks ago. The alert is resolved with no
// admin (resolvedById null) and meta.autoResolved saying why; it then clears
// after the usual 7 days like any resolved alert (lib/adminNotificationKinds.ts).
//
// Each rule reads the alert's own record id from meta and checks that record's
// current state. A rule only ever settles: it never reopens or deletes.

import { prisma } from "@nolsaf/prisma";
import { adminKindKey, rowRequiresAction } from "./adminNotificationKinds.js";

const db = prisma as any;
type Settled = Map<number, string>; // source id -> reason

type Rule = { field: string; check: (client: any, ids: number[]) => Promise<Settled> };

const lower = (s: string) => String(s || "").toLowerCase().replace(/_/g, " ");

async function byStatus(rows: Array<{ id: number; status: string }>, ids: number[], decided: (status: string) => string | null, missing: string): Promise<Settled> {
  const out: Settled = new Map();
  const found = new Map(rows.map((r) => [r.id, r.status]));
  for (const id of ids) {
    const status = found.get(id);
    if (status == null) out.set(id, missing);
    else {
      const reason = decided(String(status).toUpperCase());
      if (reason) out.set(id, reason);
    }
  }
  return out;
}

export const SETTLE_RULES: Record<string, Rule> = {
  property_submitted: {
    field: "propertyId",
    check: async (client, ids) => byStatus(
      await client.property.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (s === "PENDING" ? null : `The property was ${lower(s)}.`), "The property no longer exists.",
    ),
  },
  careers_application_submitted: {
    field: "applicationId",
    check: async (client, ids) => byStatus(
      await client.jobApplication.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (s === "PENDING" ? null : `The application was marked ${lower(s)}.`), "The application no longer exists.",
    ),
  },
  cancellation_submitted: {
    field: "requestId",
    check: async (client, ids) => byStatus(
      await client.cancellationRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (["APPROVED", "REFUND_PENDING", "REFUNDED", "REJECTED"].includes(s) ? `The cancellation was ${lower(s)}.` : null), "The cancellation no longer exists.",
    ),
  },
  cancellation_message: {
    field: "requestId",
    check: async (client, ids) => byStatus(
      await client.cancellationRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (["REFUNDED", "REJECTED"].includes(s) ? `The cancellation is closed (${lower(s)}).` : null), "The cancellation no longer exists.",
    ),
  },
  tour_cancellation_submitted: {
    field: "caseId",
    check: async (client, ids) => byStatus(
      await client.tourCase.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (["APPROVED", "REJECTED", "RESOLVED", "WITHDRAWN"].includes(s) ? `The tour case was ${lower(s)}.` : null), "The tour case no longer exists.",
    ),
  },
  owner_payout_claim_submitted: {
    field: "invoiceId",
    check: async (client, ids) => byStatus(
      await client.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (["PAID", "REJECTED"].includes(s) ? `The payout claim was ${lower(s)}.` : null), "The invoice no longer exists.",
    ),
  },
  transport_payout_claim_submitted: {
    field: "transportBookingId",
    check: async (client, ids) => {
      const rows = await client.transportPayout.findMany({ where: { transportBookingId: { in: ids } }, select: { transportBookingId: true, status: true } });
      return byStatus(rows.map((r: any) => ({ id: r.transportBookingId, status: r.status })), ids,
        (s) => (s === "PAID" ? "The driver was paid." : null), "The driver payout no longer exists.");
    },
  },
  sales_partner_conversion_requested: {
    field: "leadId",
    check: async (client, ids) => byStatus(
      await client.salesLead.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (s === "CONVERSION_REQUESTED" ? null : s === "CONVERTED" ? "The conversion was approved." : "The conversion was returned to the partner."), "The lead no longer exists.",
    ),
  },
  group_stay_request_created: {
    field: "groupBookingId",
    check: async (client, ids) => byStatus(
      await client.groupBooking.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }), ids,
      (s) => (s === "PENDING" ? null : `The group stay moved on (${lower(s)}).`), "The group stay no longer exists.",
    ),
  },
};

type AlertRow = { id: number; unread: boolean; readAt?: Date | null; resolvedAt: Date | null; type?: string | null; meta?: unknown; requiresAction?: boolean | null };

/**
 * Settle the given alerts whose source has been decided. Returns the ids it
 * closed and why, so a caller showing these rows can reflect it at once.
 */
export async function autoSettleAdminNotifications(rows: AlertRow[], now = new Date(), client: any = db): Promise<Map<number, string>> {
  const closed = new Map<number, string>();
  const open = rows.filter((r) => !r.resolvedAt && rowRequiresAction(r) && SETTLE_RULES[adminKindKey(r)]);
  const byKind = new Map<string, AlertRow[]>();
  for (const row of open) {
    const key = adminKindKey(row);
    byKind.set(key, [...(byKind.get(key) ?? []), row]);
  }
  for (const [kind, group] of byKind) {
    const rule = SETTLE_RULES[kind];
    const sourceOf = (row: AlertRow) => Number((row.meta as any)?.[rule.field]);
    const ids = [...new Set(group.map(sourceOf).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) continue;
    let settled: Settled;
    try {
      settled = await rule.check(client, ids);
    } catch (err: any) {
      console.error(`[admin-notifications] settle check ${kind} failed:`, err?.message || err);
      continue;
    }
    for (const row of group) {
      const reason = settled.get(sourceOf(row));
      if (!reason) continue;
      const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {};
      const result = await client.notification.updateMany({
        where: { id: row.id, resolvedAt: null },
        data: {
          unread: false,
          ...(row.unread ? { readAt: now } : {}),
          resolvedAt: now,
          resolvedById: null,
          meta: { ...meta, autoResolved: reason },
        },
      });
      if (result.count === 1) closed.set(row.id, reason);
    }
  }
  return closed;
}

/** Hourly sweep over every open admin alert that has a settle rule. */
export async function sweepAutoSettle(now = new Date(), client: any = db): Promise<{ settled: number }> {
  const rows = await client.notification.findMany({
    where: {
      resolvedAt: null,
      OR: [{ userId: null, ownerId: null }, { ownerId: null, user: { is: { role: "ADMIN" } } }],
    },
    select: { id: true, unread: true, readAt: true, resolvedAt: true, type: true, meta: true, requiresAction: true },
    orderBy: { id: "desc" },
    take: 2000,
  });
  const closed = await autoSettleAdminNotifications(rows, now, client);
  return { settled: closed.size };
}
