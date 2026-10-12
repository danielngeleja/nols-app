import { describe, expect, it } from 'vitest';
import { presentOwnerBookingNotification } from './ownerNotificationPresentation.js';

describe('owner booking notification presentation', () => {
  const reference = 'bk_0123456789abcdefghijkl';

  it('replaces the internal booking ID and removes a legacy code from cancellation updates', () => {
    const item = {
      body: 'A guest has requested to cancel their booking #43 at "Namibia Villa" (code: VQQB2Z3U). The admin team is reviewing this request.',
      meta: { notificationKind: 'cancellation_reviewing', bookingId: 43, bookingCode: 'VQQB2Z3U' },
    };
    expect(presentOwnerBookingNotification(item, reference)).toEqual({
      body: `A guest has requested to cancel their booking ${reference} at "Namibia Villa". The admin team is reviewing this request.`,
      meta: { notificationKind: 'cancellation_reviewing', bookingId: 43, bookingReference: reference },
    });
    expect(presentOwnerBookingNotification(item).body).not.toContain('#43');
  });

  it('preserves the rest of a paid booking notice', () => {
    expect(presentOwnerBookingNotification({ body: 'Booking #75 has been paid for JAMIREX HOTEL. Receipt: RCPT/2026/00027', meta: { kind: 'invoice_paid', bookingId: 75 } }, reference).body)
      .toBe(`Booking ${reference} has been paid for JAMIREX HOTEL. Receipt: RCPT/2026/00027`);
  });
});
