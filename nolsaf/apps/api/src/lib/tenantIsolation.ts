export type TenantDimension = "userId" | "ownerId" | "propertyId" | "partnerId";

/** Reject missing, fractional, negative, and unsafe tenant identifiers. */
export function requireTenantId(value: number, label = "tenantId"): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

/**
 * Compose an ORM where-clause whose tenant dimension cannot be overridden by
 * caller-controlled filters. The authoritative tenant value is assigned last.
 */
export function tenantWhere<K extends TenantDimension, T extends Record<string, unknown>>(
  dimension: K,
  tenantId: number,
  filters: T,
): T & Record<K, number> {
  return {
    ...filters,
    [dimension]: requireTenantId(tenantId, dimension),
  } as T & Record<K, number>;
}

