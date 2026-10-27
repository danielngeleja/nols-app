import { prisma } from "@nolsaf/prisma";
import { deliverGuestCheckinCode } from "./guestCodeRequests.js";
import { getBookingConfirmedEmail } from "./bookingEmailTemplates.js";
import { generateBookingTicketPdf } from "./pdfDocuments.js";
import { sendMail, type MailAttachment } from "./mailer.js";

function digits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "").slice(-9);
}

/** Delivers an existing active code only to the original booking phone and a
 * verified account email. The caller never receives the code. */
export async function deliverBookingCaseConfirmation(bookingId: number): Promise<{
  channels: string[];
  destinationMasked: string | null;
  ownerPhoneOverlap: boolean;
}> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      code: true,
      property: { select: { title: true, owner: { select: { phone: true } } } },
      user: { select: { email: true, emailVerifiedAt: true } },
    },
  });
  if (!booking || !["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN"].includes(booking.status) || booking.code?.status !== "ACTIVE") {
    throw new Error("No active check-in code is available for this booking");
  }
  if (new Date(booking.checkOut).getTime() + 24 * 60 * 60 * 1000 <= Date.now()) {
    throw new Error("The stay has ended; the check-in code cannot be resent");
  }

  const ownerPhoneOverlap = Boolean(digits(booking.guestPhone) && digits(booking.guestPhone) === digits(booking.property.owner.phone));
  const delivered = await deliverGuestCheckinCode({
    id: booking.id,
    userId: booking.userId,
    guestPhone: ownerPhoneOverlap ? null : booking.guestPhone,
    code: { code: booking.code.code },
  });
  const channels: string[] = delivered.channel ? [delivered.channel] : [];

  if (booking.user?.email && booking.user.emailVerifiedAt) {
    try {
      const { subject, html } = getBookingConfirmedEmail({
        guestName: booking.guestName || "Guest",
        propertyName: booking.property.title,
        bookingId: booking.id,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        totalAmount: booking.totalAmount as any,
        roomsQty: booking.roomsQty,
        checkinCode: booking.code.code,
      });
      let attachments: MailAttachment[] | undefined;
      try {
        const pdf = await generateBookingTicketPdf({
          bookingId: booking.id,
          bookingCode: booking.code.code,
          guestName: booking.guestName || "Guest",
          propertyName: booking.property.title,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          rooms: booking.roomsQty,
          totalAmount: Number(booking.totalAmount),
          confirmedAt: new Date(),
        });
        attachments = [{ filename: "Booking-confirmation.pdf", content: pdf }];
      } catch { /* Email still goes out if PDF rendering is unavailable. */ }
      await sendMail(booking.user.email, subject, html, attachments, { replyTo: "bookings@nolsaf.com" });
      channels.push("EMAIL");
    } catch (error: any) {
      console.warn("[booking-payment-case] verified email delivery failed", { bookingId, message: error?.message });
    }
  }

  return { channels, destinationMasked: delivered.destinationMasked, ownerPhoneOverlap };
}
