import { prisma } from "@nolsaf/prisma";
import { customerRecordReference, isCustomerRecordReference, matchesCustomerRecordReference } from "./customerBookingReference.js";

const cache = new Map<string, number>();

/** Opaque case reference for browser URLs and support conversations. */
export function bookingPaymentCaseReference(caseId: number): string {
  return customerRecordReference("payment-case", caseId);
}

/** Cases are admin-only. The reference cannot be decoded, so resolve against
 * candidate ids and cache successful matches. */
export async function resolveBookingPaymentCaseReference(reference: string): Promise<number | null> {
  const value = String(reference || "").trim();
  if (!isCustomerRecordReference(value, "payment-case")) return null;
  const cached = cache.get(value);
  if (cached) return cached;

  let cursor: number | undefined;
  for (;;) {
    const rows = await prisma.bookingPaymentCase.findMany({
      select: { id: true }, orderBy: { id: "desc" }, take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const match = rows.find((row) => matchesCustomerRecordReference(value, "payment-case", row.id));
    if (match) {
      if (cache.size >= 1000) cache.clear();
      cache.set(value, match.id);
      return match.id;
    }
    if (rows.length < 1000) return null;
    cursor = rows[rows.length - 1].id;
  }
}
