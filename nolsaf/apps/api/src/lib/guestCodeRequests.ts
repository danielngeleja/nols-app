import { prisma } from "@nolsaf/prisma";
import { sendSms } from "./sms.js";
import { customerBookingReference } from "./customerBookingReference.js";

/**
 * Getting a guest's check-in code back to the guest. Shared by the owner's
 * request and the admin who resolves one, so both deliver it the same way:
 *
 * - The code goes only to the contact captured on the booking (guestPhone). A
 *   later account-contact change must not redirect a guest-held check-in secret.
 * - The guest's NoLSAF account also gets an inbox notice pointing at My
 *   Bookings, where the code is shown; that notice never contains the code.
 * - The owner never receives the code.
 */

export type GuestCodeChannel = "IN_APP" | "SMS";
export type GuestCodeRequestStatus = "SENT" | "NEEDS_REVIEW" | "UNREACHABLE" | "RESOLVED" | "REJECTED";

export const OPEN_GUEST_CODE_STATUSES: GuestCodeRequestStatus[] = ["NEEDS_REVIEW", "UNREACHABLE"];

/** "•••• 4321": enough for the owner to recognise the number, never the whole thing. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}

export async function deliverGuestCheckinCode(booking: {
  id: number;
  userId: number | null;
  guestPhone: string | null;
  code: { code: string };
}): Promise<{ channel: GuestCodeChannel | null; destinationMasked: string | null }> {
  const reference = customerBookingReference(booking.id);
  const message = `NoLSAF: Your property has asked you to present the check-in code for booking ${reference}. Find it in My Bookings or your booking message. Show it only if you are checking in. If unexpected, contact NoLSAF support.`;
  let channel: GuestCodeChannel | null = null;
  let destinationMasked: string | null = null;

  if (booking.userId) {
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          title: "Present your check-in code",
          body: message,
          type: "booking",
          unread: true,
          meta: { bookingId: booking.id, kind: "guest_checkin_code_requested" },
        },
      });
      channel = "IN_APP";
      destinationMasked = "NoLSAF inbox";
    } catch (err: any) {
      console.warn("[guest-code] inbox notice failed", { bookingId: booking.id, message: err?.message });
    }
  }

  if (booking.guestPhone) {
    try {
      const result = await sendSms(booking.guestPhone, `${message}\nYour check-in code: ${booking.code.code}`, { bypassEligibilityCheck: true, sensitiveContent: true });
      if (result.success && result.provider && !["suppressed", "console"].includes(result.provider)) {
        channel = "SMS";
        destinationMasked = maskPhone(booking.guestPhone);
      }
    } catch (err: any) {
      console.warn("[guest-code] SMS failed", { bookingId: booking.id, message: err?.message });
    }
  }

  return { channel, destinationMasked };
}

/**
 * Records a request. Never throws: until the guest_code_request migration is
 * applied the table is missing, and delivering the code must not depend on it.
 */
export async function recordGuestCodeRequest(data: {
  bookingId: number;
  ownerId: number;
  status: GuestCodeRequestStatus;
  channel?: GuestCodeChannel | null;
  destinationMasked?: string | null;
  reason?: string | null;
}): Promise<{ id: number } | null> {
  try {
    return await (prisma as any).guestCodeRequest.create({
      data: {
        bookingId: data.bookingId,
        ownerId: data.ownerId,
        status: data.status,
        channel: data.channel ?? null,
        destinationMasked: data.destinationMasked ?? null,
        reason: data.reason ?? null,
      },
      select: { id: true },
    });
  } catch (err: any) {
    console.warn("[guest-code] request not recorded (is the migration applied?)", { bookingId: data.bookingId, message: err?.message });
    return null;
  }
}
