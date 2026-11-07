/**
 * Opaque references for the sales portal, so no page address or screen ever
 * shows a database id:
 *   sl_…  a lead          sp_…  a sales partner (team member)
 *   pp_…  a property (the same kind admin pages use)
 *
 * A reference is an HMAC of the kind and id and cannot be decoded. It is
 * resolved only among the records the caller may already see (their own leads,
 * their own attributed properties, their own team), so resolving is cheap and a
 * guessed or foreign reference simply finds nothing.
 */
import {
  customerRecordReference,
  isCustomerRecordReference,
  matchesCustomerRecordReference,
  type CustomerRecordKind,
} from "./customerBookingReference.js";

type SalesRefKind = Extract<CustomerRecordKind, "sales-lead" | "sales-partner" | "property">;

export const leadRef = (id: number) => customerRecordReference("sales-lead", id);
export const partnerRef = (id: number) => customerRecordReference("sales-partner", id);
export const propertyRef = (id: number) => customerRecordReference("property", id);

/** Which of the allowed ids this reference names, or null. */
export function resolveAmong(kind: SalesRefKind, reference: unknown, allowedIds: Iterable<number>): number | null {
  const value = String(reference ?? "").trim();
  if (!isCustomerRecordReference(value, kind)) return null;
  for (const id of allowedIds) {
    if (matchesCustomerRecordReference(value, kind, id)) return id;
  }
  return null;
}

/** A lead reference resolved within one partner's own leads. */
export async function resolvePartnerLead(db: any, reference: unknown, salesPartnerId: number): Promise<number | null> {
  if (!isCustomerRecordReference(String(reference ?? "").trim(), "sales-lead")) return null;
  const rows = await db.salesLead.findMany({ where: { salesPartnerId }, select: { id: true }, orderBy: { id: "desc" }, take: 5000 });
  return resolveAmong("sales-lead", reference, rows.map((row: any) => row.id));
}

/** A property reference resolved within the properties attributed to one partner. */
export async function resolvePartnerProperty(db: any, reference: unknown, salesPartnerId: number): Promise<number | null> {
  if (!isCustomerRecordReference(String(reference ?? "").trim(), "property")) return null;
  const rows = await db.propertySalesAttribution.findMany({ where: { salesPartnerId }, select: { propertyId: true }, distinct: ["propertyId"] });
  return resolveAmong("property", reference, rows.map((row: any) => row.propertyId));
}
