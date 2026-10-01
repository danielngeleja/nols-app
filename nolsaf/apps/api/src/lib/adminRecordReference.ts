import { prisma } from "@nolsaf/prisma";
import {
  customerRecordReference,
  isCustomerRecordReference,
  matchesCustomerRecordReference,
  type CustomerRecordKind,
} from "./customerBookingReference.js";

/**
 * Opaque references for admin page URLs. A reference is an HMAC of the kind and
 * row id, so it cannot be decoded; resolving one means checking candidate ids
 * of that kind, newest first, with a small cache. Every admin detail page is
 * addressed this way so the address bar never shows a database id.
 */
export type AdminRecordKind = Extract<
  CustomerRecordKind,
  | "booking" | "user" | "owner" | "driver" | "agent" | "tour" | "cancellation" | "tour-case"
  | "disbursement-batch" | "property" | "merchant-application" | "transport-payout" | "owner-invoice" | "group-stay"
>;

export const ADMIN_RECORD_KINDS: readonly AdminRecordKind[] = [
  "booking", "user", "owner", "driver", "agent", "tour", "cancellation", "tour-case",
  "disbursement-batch", "property", "merchant-application", "transport-payout", "owner-invoice", "group-stay",
];

type IdPage = (cursor: number | undefined, take: number) => Promise<Array<{ id: number }>>;

const page = (model: any, where?: Record<string, unknown>): IdPage => (cursor, take) =>
  model.findMany({
    where,
    select: { id: true },
    orderBy: { id: "desc" },
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

/** Where each kind's ids live. Owners and drivers are users narrowed by role. */
const SOURCES: Record<AdminRecordKind, () => IdPage> = {
  booking: () => page((prisma as any).booking),
  user: () => page((prisma as any).user),
  owner: () => page((prisma as any).user, { role: "OWNER" }),
  driver: () => page((prisma as any).user, { role: "DRIVER" }),
  agent: () => page((prisma as any).agent),
  tour: () => page((prisma as any).tourBooking),
  cancellation: () => page((prisma as any).cancellationRequest),
  "tour-case": () => page((prisma as any).tourCase),
  "disbursement-batch": () => page((prisma as any).disbursementBatch),
  property: () => page((prisma as any).property),
  "merchant-application": () => page((prisma as any).merchantApplication),
  "transport-payout": () => page((prisma as any).transportPayout),
  "owner-invoice": () => page((prisma as any).invoice),
  "group-stay": () => page((prisma as any).groupBooking),
};

export function isAdminRecordKind(value: unknown): value is AdminRecordKind {
  return typeof value === "string" && (ADMIN_RECORD_KINDS as readonly string[]).includes(value);
}

/** The reference to put in an admin URL for this record. */
export function adminRecordReference(kind: AdminRecordKind, id: number): string {
  return customerRecordReference(kind, id);
}

/** Like adminRecordReference, but never throws (bad or missing ids give null). */
export function adminRecordReferenceOrNull(kind: AdminRecordKind, id: unknown): string | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? customerRecordReference(kind, n) : null;
}

const cache = new Map<string, number>();
const CACHE_LIMIT = 2000;
const PAGE_SIZE = 2000;

/** Resolves a reference of the given kind back to its row id, or null. */
export async function resolveAdminRecordReference(kind: AdminRecordKind, reference: string): Promise<number | null> {
  const value = String(reference || "").trim();
  if (!isCustomerRecordReference(value, kind)) return null;
  const key = `${kind}:${value}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const next = SOURCES[kind]();
  let cursor: number | undefined;
  for (;;) {
    const rows = await next(cursor, PAGE_SIZE);
    if (rows.length === 0) return null;
    const found = rows.find((row) => matchesCustomerRecordReference(value, kind, row.id));
    if (found) {
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(key, found.id);
      return found.id;
    }
    if (rows.length < PAGE_SIZE) return null;
    cursor = rows[rows.length - 1].id;
  }
}
