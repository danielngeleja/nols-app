import { prisma } from "@nolsaf/prisma";
import { customerBookingReference, isCustomerBookingReference, matchesCustomerBookingReference } from "./customerBookingReference.js";

/**
 * Admin booking URLs carry the opaque `bk_` reference (the same one customer
 * and owner links use), never the row id. A reference is an HMAC, so it cannot
 * be decoded; resolving it means checking candidate ids. Admins can see every
 * booking, so this walks ids newest first in pages and stops at the first
 * match, with a small cache so reopening a booking costs one map lookup.
 */
const cache = new Map<string, number>();
const CACHE_LIMIT = 1000;
const PAGE = 2000;

export async function resolveAdminBookingReference(reference: string): Promise<number | null> {
  const value = String(reference || "").trim();
  if (!isCustomerBookingReference(value)) return null;

  const cached = cache.get(value);
  if (cached) return cached;

  let cursor: number | undefined;
  for (;;) {
    const rows = await prisma.booking.findMany({
      select: { id: true },
      orderBy: { id: "desc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return null;
    const found = rows.find((row) => matchesCustomerBookingReference(value, row.id));
    if (found) {
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(value, found.id);
      return found.id;
    }
    if (rows.length < PAGE) return null;
    cursor = rows[rows.length - 1].id;
  }
}

/** The reference to put in an admin booking URL. */
export function adminBookingReference(bookingId: number): string {
  return customerBookingReference(bookingId);
}
