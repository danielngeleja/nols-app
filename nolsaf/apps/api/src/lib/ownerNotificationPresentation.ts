export const OWNER_BOOKING_NOTIFICATION_KINDS = new Set([
  'booking_created', 'invoice_paid', 'cancellation_reviewing', 'cancellation_processing',
  'cancellation_refunded', 'cancellation_rejected', 'booking_cancelled_by_guest',
]);

const CANCELLATION_KINDS = new Set([
  'cancellation_reviewing', 'cancellation_processing', 'cancellation_refunded',
  'cancellation_rejected', 'booking_cancelled_by_guest',
]);

export function presentOwnerBookingNotification<T extends { body: string; meta?: Record<string, unknown> | null }>(
  item: T,
  reference?: string,
): T {
  const kind = String(item.meta?.notificationKind ?? item.meta?.kind ?? '');
  if (!OWNER_BOOKING_NOTIFICATION_KINDS.has(kind)) return item;

  let body = item.body.replace(/([Bb]ooking) #\d+\b/g, (_match, word: string) => reference ? `${word} ${reference}` : word);
  const meta = { ...item.meta };
  if (CANCELLATION_KINDS.has(kind)) {
    body = body.replace(/\s*\(code: [^)]+\)/gi, '');
    delete meta.bookingCode;
  }
  if (reference) meta.bookingReference = reference;
  return { ...item, body, meta };
}
