import { apiRequest } from "./apiClient";

/** One payment provider's admin-controlled availability, from the public endpoint. */
export type PaymentMethodAvailability = {
  provider: string;
  label: string;
  isEnabled: boolean;
  reason: string | null;
};

/** Transport add-on availability for a property's area. */
export type TransportGate = {
  enabled: boolean;
  reason: string | null;
};

/**
 * Every payment provider with its current enabled/disabled state and reason.
 * Drives which methods the checkout offers, so nothing is hardcoded: if an admin
 * disables M-Pesa or a bank, it comes back here and the UI reflects it.
 */
export async function fetchPaymentMethodAvailability(): Promise<PaymentMethodAvailability[]> {
  return apiRequest<PaymentMethodAvailability[]>("/api/public/service-availability/payment-methods");
}

/** Whether the ride add-on is open for the given property's region/ward. */
export async function fetchTransportAvailability(propertyId: number): Promise<TransportGate> {
  return apiRequest<TransportGate>(`/api/public/service-availability/transport?propertyId=${propertyId}`);
}

/** Build a quick lookup from the availability list, keyed by provider id. */
export function toAvailabilityMap(
  rows: PaymentMethodAvailability[]
): Map<string, { isEnabled: boolean; reason: string | null }> {
  return new Map(rows.map((r) => [r.provider, { isEnabled: r.isEnabled, reason: r.reason }]));
}
