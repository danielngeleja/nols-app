export type ExpediaReservationAction = "CREATE" | "MODIFY" | "CANCEL";

export type ExpediaReservationMessage = {
  providerReservationId: string;
  propertyId: string;
  action: ExpediaReservationAction;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  currency: string;
  totalAmount: number;
  roomStays: Array<{ roomTypeExternalId: string; rateExternalId: string | null; quantity: number; checkIn: string; checkOut: string }>;
  roomTypeExternalIds: string[];
  rateExternalIds: string[];
  updatedAt: string;
  raw: Record<string, unknown>;
};

export type ExpediaReservationNotification = {
  notificationId: string;
  eventName: string;
  propertyId: string;
  reservationId: string;
  actionType: string;
  confirmationToken: string | null;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ids(value: unknown, preferredSource = "EXPEDIA"): string[] {
  if (!Array.isArray(value)) return [];
  const rows = value.map(record);
  const preferred = rows.filter((row) => string(row.idSource).toUpperCase() === preferredSource).map((row) => string(row.id)).filter(Boolean);
  return preferred.length ? preferred : rows.map((row) => string(row.id)).filter(Boolean);
}

function amount(reservation: Record<string, any>): { amount: number; currency: string } {
  const summary = Array.isArray(record(reservation.amounts).summary) ? record(reservation.amounts).summary.map(record) : [];
  const selected = summary.find((row) => ["GUEST_PAYMENT", "TOTAL", "BASE"].includes(string(row.type).toUpperCase())) ?? summary[0];
  const money = record(selected?.amount);
  return { amount: Math.max(0, number(money.amount)), currency: (string(money.currencyCode) || "TZS").slice(0, 3).toUpperCase() };
}

export function parseExpediaReservation(rawValue: unknown): ExpediaReservationMessage {
  const raw = record(rawValue);
  const providerReservationId = string(raw.id);
  const propertyId = string(raw.propertyId);
  const status = string(raw.status).toUpperCase();
  const creationDateTime = string(raw.creationDateTime);
  const updatedAt = string(raw.lastUpdatedDateTime) || creationDateTime;
  const action: ExpediaReservationAction = status === "CANCELLED"
    ? "CANCEL"
    : creationDateTime && updatedAt && creationDateTime !== updatedAt
      ? "MODIFY"
      : "CREATE";
  const primaryGuest = record(raw.primaryGuest);
  const phone = Array.isArray(primaryGuest.phoneNumbers) ? record(primaryGuest.phoneNumbers[0]) : {};
  const roomTypeExternalIds = [...new Set(ids(raw.unitIds))];
  const rateExternalIds = [...new Set(ids(raw.rateIds, "SUPPLIER"))];
  const checkIn = string(raw.checkInDate);
  const checkOut = string(raw.checkOutDate);
  const money = amount(raw);
  return {
    providerReservationId,
    propertyId,
    action,
    checkIn,
    checkOut,
    adults: Math.max(1, Math.trunc(number(raw.adultCount))),
    children: Math.max(0, Math.trunc(number(raw.childCount))),
    guestName: `${string(primaryGuest.firstName)} ${string(primaryGuest.lastName)}`.trim().slice(0, 160) || "Expedia guest",
    guestPhone: string(phone.fullPhoneNumber) || null,
    guestEmail: string(primaryGuest.emailAddress) || null,
    currency: money.currency,
    totalAmount: money.amount,
    roomStays: roomTypeExternalIds.map((roomTypeExternalId, index) => ({
      roomTypeExternalId,
      rateExternalId: rateExternalIds[index] ?? rateExternalIds[0] ?? null,
      quantity: 1,
      checkIn,
      checkOut,
    })),
    roomTypeExternalIds,
    rateExternalIds,
    updatedAt,
    raw,
  };
}

/** Persist only operational reservation fields; payment instruments, loyalty
 * identifiers, free text and full provider responses stay out of the inbox. */
export function expediaEventPayload(message: ExpediaReservationMessage): Record<string, unknown> {
  return {
    providerReservationId: message.providerReservationId,
    propertyId: message.propertyId,
    action: message.action,
    checkIn: message.checkIn,
    checkOut: message.checkOut,
    adults: message.adults,
    children: message.children,
    currency: message.currency,
    totalAmount: message.totalAmount,
    roomStays: message.roomStays,
    updatedAt: message.updatedAt,
  };
}

export function parseExpediaReservationNotification(value: unknown): ExpediaReservationNotification | null {
  const root = record(value);
  const payload = record(root.payload);
  const notificationId = string(root.notification_id ?? root.notificationId);
  const eventName = string(root.event_name ?? root.eventName);
  const propertyId = string(payload.property_id ?? payload.propertyId);
  const reservationId = string(payload.reservation_id ?? payload.reservationId);
  const actionType = string(payload.action_type ?? payload.actionType ?? eventName).toUpperCase();
  const confirmationToken = string(payload.confirmation_token ?? payload.confirmationToken) || null;
  if (!notificationId || !eventName || !propertyId || !reservationId) return null;
  return { notificationId, eventName, propertyId, reservationId, actionType, confirmationToken };
}
