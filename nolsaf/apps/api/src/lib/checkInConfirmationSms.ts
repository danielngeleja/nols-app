/**
 * Guest SMS the moment a check-in code is validated.
 *
 * Protective: the code is the proof the guest arrived and it unlocks the
 * owner's payout, so the guest is told at once when and where it was used.
 * A guest who did not check in sees it and can call NoLSAF before any money
 * moves (the payout date lock gives at least 24 hours). No report flow:
 * the message points to support only.
 *
 * Independent of PAYOUT_RELEASE_ENABLED. Sent after the check-in commits and
 * never awaited, so an SMS problem can never delay the desk.
 */

import { prisma } from "@nolsaf/prisma";
import { sendSms } from "./sms.js";
import { getSupportContact } from "./tripSafety.js";

const TITLE_MAX = 40;

function formatEat(date: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)} EAT`;
}

export function checkInConfirmationText(input: { propertyTitle: string | null; usedAt: Date; supportPhone: string }): string {
  const raw = String(input.propertyTitle || "your stay").trim();
  const title = raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1).trimEnd()}.` : raw;
  return (
    `NoLSAF: Check-in confirmed at ${title} on ${formatEat(input.usedAt)}. ` +
    `If you have not checked in, call NoLSAF now on ${input.supportPhone}.`
  );
}

async function send(bookingId: number): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      guestPhone: true,
      user: { select: { phone: true } },
      property: { select: { title: true } },
      code: { select: { status: true, usedAt: true } },
    },
  });
  if (!booking || booking.code?.status !== "USED" || !booking.code.usedAt) return;
  const phone = booking.guestPhone || booking.user?.phone;
  if (!phone) return;

  const support = await getSupportContact();
  const result = await sendSms(
    phone,
    checkInConfirmationText({ propertyTitle: booking.property?.title ?? null, usedAt: booking.code.usedAt, supportPhone: support.phone })
  );
  if (!result.success) {
    console.warn("[checkin-sms] guest confirmation not delivered", { bookingId, error: result.error });
  }
}

/** Fire and forget; call only after the check-in transaction has committed. */
export function notifyGuestCheckInConfirmed(bookingId: number): void {
  void send(bookingId).catch((err) => {
    console.error("[checkin-sms] guest confirmation failed", { bookingId, message: err?.message });
  });
}
