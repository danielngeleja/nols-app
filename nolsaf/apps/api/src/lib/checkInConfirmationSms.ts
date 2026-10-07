/** Guest awareness after a validated accommodation check-in. Provider acceptance
 * is recorded before a new owner payout may become withdrawable. */
import { prisma } from "@nolsaf/prisma";
import { sendSms } from "./sms.js";
import { sendMail } from "./mailer.js";
import { getSupportContact } from "./tripSafety.js";
import { retentionFields } from "./auditRetention.js";

export const CHECKIN_ALERT_ACTION = "GUEST_CHECKIN_CONFIRMATION_ACCEPTED";
const TITLE_MAX = 40;

function formatEat(date: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date)} EAT`;
}

export function checkInConfirmationText(input: { propertyTitle: string | null; usedAt: Date; supportPhone: string }): string {
  const raw = String(input.propertyTitle || "your stay").trim();
  const title = raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1).trimEnd()}.` : raw;
  return `NoLSAF: Check-in confirmed at ${title} on ${formatEat(input.usedAt)}. ` +
    `If you have not checked in, call NoLSAF now on ${input.supportPhone}.`;
}

export async function guestCheckInAlertAccepted(bookingId: number): Promise<boolean> {
  return !!(await prisma.auditLog.findFirst({
    where: { entity: "Booking", entityId: bookingId, action: CHECKIN_ALERT_ACTION },
    select: { id: true },
  }));
}

/** Returns true only after SMS or email provider acceptance has been saved. */
export async function ensureGuestCheckInConfirmation(bookingId: number): Promise<boolean> {
  if (await guestCheckInAlertAccepted(bookingId)) return true;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      guestPhone: true,
      guestEmail: true,
      user: { select: { phone: true, email: true } },
      property: { select: { title: true } },
      code: { select: { status: true, usedAt: true } },
    },
  });
  if (!booking || booking.code?.status !== "USED" || !booking.code.usedAt) return false;

  const support = await getSupportContact();
  const message = checkInConfirmationText({
    propertyTitle: booking.property?.title ?? null,
    usedAt: booking.code.usedAt,
    supportPhone: support.phone,
  });
  let accepted: { channel: "SMS" | "EMAIL"; provider: string; messageId?: string } | null = null;
  const phone = booking.guestPhone || booking.user?.phone;
  if (phone) {
    try {
      const result = await sendSms(phone, message, { bypassEligibilityCheck: true });
      if (result.success && result.provider && !["suppressed", "console"].includes(result.provider)) {
        accepted = { channel: "SMS", provider: result.provider, messageId: result.messageId };
      }
    } catch (err: any) {
      console.warn("[checkin-alert] SMS not accepted", { bookingId, message: err?.message });
    }
  }
  const email = booking.guestEmail || booking.user?.email;
  if (!accepted && email) {
    try {
      const result = await sendMail(
        email,
        "Your NoLSAF check-in was confirmed",
        `<p>${message}</p>`, undefined,
        { bypassEligibilityCheck: true, sensitiveContent: true },
      );
      if (result.success && !["suppressed", "console"].includes(result.provider)) {
        accepted = { channel: "EMAIL", provider: result.provider, messageId: result.messageId };
      }
    } catch (err: any) {
      console.warn("[checkin-alert] email not accepted", { bookingId, message: err?.message });
    }
  }
  if (!accepted) {
    console.warn("[checkin-alert] no provider accepted guest confirmation", { bookingId });
    return false;
  }
  await prisma.auditLog.create({
    data: {
      actorRole: "SYSTEM", action: CHECKIN_ALERT_ACTION, entity: "Booking", entityId: bookingId,
      afterJson: { ...accepted, codeUsedAt: booking.code.usedAt.toISOString() },
      ...retentionFields("FINANCIAL"),
    },
  });
  return true;
}
