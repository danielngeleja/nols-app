/**
 * bookingEmailTemplates.ts
 * ─────────────────────────────────────────────────────────────
 * Customer-facing transactional emails for booking lifecycle:
 *   - Booking received (NEW)
 *   - Booking confirmed (CONFIRMED + check-in code)
 *   - Booking cancelled (CANCELED)
 */
import {
  BRAND_TEAL,
  proEmail,
  proDivider,
  proReferenceCard,
  proHighlight,
  proNoteCard,
  proDetailRows,
} from "./emailBase.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function nightCount(checkIn: Date | string, checkOut: Date | string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function fmtMoney(amount: number | string, currency = "TZS"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Shared data shape ────────────────────────────────────────────────────────

export interface BookingEmailData {
  /** Guest display name */
  guestName: string;
  /** Property name */
  propertyName: string;
  /** Booking ID (numeric) */
  bookingId: number;
  /** Human-readable booking reference code (e.g. BK-A1B2C3) */
  bookingCode?: string;
  checkIn: Date | string;
  checkOut: Date | string;
  totalAmount: number | string;
  roomsQty?: number;
  /** Customer-facing booking detail URL (optional) */
  bookingUrl?: string;
}

// ─── 1. Booking Confirmed (received) ─────────────────────────────────────────

/**
 * Sent immediately when a new booking is created and payment is accepted.
 * Celebrates the booking and shows the booking reference code prominently.
 */
export function getBookingReceivedEmail(data: BookingEmailData): { subject: string; html: string } {
  const nights = nightCount(data.checkIn, data.checkOut);
  const refCode = data.bookingCode ?? `BK${data.bookingId}`;

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.guestName}, we are delighted to welcome you. Your stay at <strong style="color:#1a1a1a;">${data.propertyName}</strong> is paid for and fully secured, and we cannot wait to host you.</p>
    ${proDivider()}
    ${proReferenceCard(
      "Booking reference",
      refCode,
      `When you arrive, show this reference to the front desk staff at ${data.propertyName}. They use it to find your booking and check you in.`
    )}
    ${proDivider()}
    ${proDetailRows(
      "Trip details",
      [
        ["Property",       data.propertyName],
        ["Check in",       fmtDate(data.checkIn)],
        ["Check out",      fmtDate(data.checkOut)],
        ["Nights",         String(nights)],
        ["Rooms",          String(data.roomsQty ?? 1)],      ],
      ["Total paid", fmtMoney(data.totalAmount)]
    )}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions about your stay? We are happy to help at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Your booking at ${data.propertyName} is confirmed (${refCode})`,
    html: proEmail("Your booking is confirmed", body),
  };
}

// ─── 2. Booking Confirmed ─────────────────────────────────────────────────────

/**
 * Sent when admin confirms the booking and generates a check-in code.
 * The check-in code is prominently displayed for the guest to show on arrival.
 */
export interface BookingConfirmedEmailData extends BookingEmailData {
  /** The visible check-in code (e.g. "ABCD9F3A") */
  checkinCode?: string;
}

export function getBookingConfirmedEmail(data: BookingConfirmedEmailData): { subject: string; html: string } {
  const nights = nightCount(data.checkIn, data.checkOut);

  const codeBlock = data.checkinCode
    ? proReferenceCard(
        "Check-in code",
        data.checkinCode,
        `When you arrive, show this code to the front desk staff at ${data.propertyName}. They use it to check you in.`
      )
    : `
      <div style="font-size:13px;font-weight:bold;letter-spacing:0.5px;color:#1a1a1a;margin-bottom:6px;">Check-in code</div>
      <p style="margin:0;color:#5f6b69;font-size:14px;line-height:1.6;">Your check-in code will be sent to you separately. Please have it ready when you arrive.</p>
    `;

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.guestName}, your booking at <strong style="color:#1a1a1a;">${data.propertyName}</strong> is confirmed. ${data.checkinCode ? "Here is your check-in code and your trip details." : "Here are your trip details."}</p>
    ${proDivider()}
    ${codeBlock}
    ${proDivider()}
    ${proDetailRows(
      "Trip details",
      [
        ["Property",       data.propertyName],
        ["Check in",       fmtDate(data.checkIn)],
        ["Check out",      fmtDate(data.checkOut)],
        ["Nights",         String(nights)],
        ["Rooms",          String(data.roomsQty ?? 1)],      ],
      ["Total", fmtMoney(data.totalAmount)]
    )}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions about your stay? We are happy to help at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Your booking at ${data.propertyName} is confirmed`,
    html: proEmail("Your booking is confirmed", body),
  };
}

// ─── 3. Booking Cancelled ─────────────────────────────────────────────────────

/**
 * Sent when a booking is cancelled (by admin or via cancellation request approval).
 */
export interface BookingCancelledEmailData extends BookingEmailData {
  /** Reason provided for the cancellation */
  cancelReason?: string;
  /** Refund information (if any) */
  refundNote?: string;
}

export function getBookingCancelledEmail(data: BookingCancelledEmailData): { subject: string; html: string } {
  const RED = "#b42318";
  const RED_BG = "#fdf3f2";
  const AMBER = "#b54708";
  const AMBER_BG = "#fdf6ec";

  const reasonBlock = data.cancelReason
    ? proNoteCard(RED, "Reason for cancellation", data.cancelReason, RED_BG)
    : "";

  const refundBlock = data.refundNote
    ? proNoteCard(AMBER, "Refund information", data.refundNote, AMBER_BG)
    : proNoteCard(
        AMBER,
        "Refund information",
        "If a refund applies to this booking, our team will process it and contact you separately.",
        AMBER_BG
      );

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.guestName}, we are writing to confirm that your booking at <strong style="color:#1a1a1a;">${data.propertyName}</strong> has been cancelled. We are sorry it did not work out this time.</p>
    ${proDivider()}
    ${proDetailRows(
      "Cancelled booking",
      [
        ["Property",       data.propertyName],
        ["Check in",       fmtDate(data.checkIn)],
        ["Check out",      fmtDate(data.checkOut)],      ],
      ["Booking total", fmtMoney(data.totalAmount)],
      RED
    )}
    ${proDivider()}
    ${reasonBlock}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${refundBlock}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Need a hand? Reach our team at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>. We hope to host you again soon.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Kind regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Your booking at ${data.propertyName} has been cancelled`,
    html: proEmail("Your booking has been cancelled", body),
  };
}

// ─── 4. Owner Disbursement Notice ─────────────────────────────────────────────

/**
 * Sent to the property owner when admin marks their payout invoice as PAID.
 * Shows financial breakdown (gross, commission, net) and disbursement details.
 */
export interface OwnerDisbursementEmailData {
  ownerName: string;
  propertyName: string;
  bookingId: number;
  invoiceNumber: string;
  receiptNumber: string;
  checkIn: Date | string;
  checkOut: Date | string;
  netPayable: number | string;
  paymentMethod?: string | null;
  paidAt: Date | string | null;
}

export function getOwnerDisbursementEmail(data: OwnerDisbursementEmailData): { subject: string; html: string } {
  const nights = nightCount(data.checkIn, data.checkOut);
  const method = (data.paymentMethod || "").replace(/_/g, " ").trim() || "Not specified";

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.ownerName}, your payout for booking <strong style="color:#1a1a1a;">${data.bookingId}</strong> at <strong style="color:#1a1a1a;">${data.propertyName}</strong> has been disbursed to your registered payment method. Thank you for being a NoLSAF partner.</p>
    ${proDivider()}
    ${proHighlight("Net amount disbursed", fmtMoney(data.netPayable), "", BRAND_TEAL)}
    ${proDivider()}
    ${proDetailRows(
      "Disbursement details",
      [        ["Property",       data.propertyName],
        ["Check in",       fmtDate(data.checkIn)],
        ["Check out",      fmtDate(data.checkOut)],
        ["Nights",         String(nights)],
        ["Invoice",        data.invoiceNumber],
        ["Receipt",        data.receiptNumber],
        ["Payment method", method],
        ["Date disbursed", fmtDate(data.paidAt ?? new Date())],
      ]
    )}
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "Receipt attached", "A detailed PDF disbursement receipt is attached to this email. Please keep it for your records.")}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions about your payout? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Payout disbursed for ${data.propertyName}`,
    html: proEmail("Your payout has been sent", body),
  };
}

// ─── 5. Tour Booking Confirmed ────────────────────────────────────────────────

/**
 * Sent to a customer when their tour booking payment is accepted.
 * Same pro design as property bookings, with tour-specific content.
 */
export interface TourBookingEmailData {
  guestName: string;
  tourTitle: string;
  destination?: string;
  startDate: Date | string;
  travelerCount: number;
  totalAmount: number | string;
  currency?: string;
  bookingId: number;
  bookingCode?: string;
}

export function getTourBookingConfirmedEmail(data: TourBookingEmailData): { subject: string; html: string } {
  const currency = data.currency || "TZS";
  const refCode = data.bookingCode ?? `TR${data.bookingId}`;

  const detailRows: Array<[string, string]> = [
    ["Tour",            data.tourTitle],
  ];
  if (data.destination) detailRows.push(["Destination", data.destination]);
  detailRows.push(
    ["Date",            fmtDate(data.startDate)],
    ["Travelers",       String(data.travelerCount)],  );

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.guestName}, we are delighted to have you. Your tour <strong style="color:#1a1a1a;">${data.tourTitle}</strong> is paid for and confirmed, and we cannot wait to share the experience with you.</p>
    ${proDivider()}
    ${proReferenceCard(
      "Booking reference",
      refCode,
      "On the day of your tour, show this reference to your NoLSAF tour operator. They use it to confirm your place."
    )}
    ${proDivider()}
    ${proDetailRows("Tour details", detailRows, ["Total paid", fmtMoney(data.totalAmount, currency)])}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions about your tour? We are happy to help at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Your tour ${data.tourTitle} is confirmed (${refCode})`,
    html: proEmail("Your tour is confirmed", body),
  };
}

// ─── 6. Group Stay Confirmed ──────────────────────────────────────────────────

/**
 * Sent to a customer when their group stay deposit is received and the stay is
 * secured. Same pro design, with group-stay-specific content.
 */
export interface GroupStayEmailData {
  guestName: string;
  /** Confirmed property name, if one has been assigned */
  propertyName?: string;
  /** Destination (e.g. region / district) */
  destination?: string;
  checkIn: Date | string;
  checkOut: Date | string;
  roomsNeeded: number;
  depositAmount: number | string;
  currency?: string;
  bookingId: number;
  bookingCode?: string;
}

export function getGroupStayConfirmedEmail(data: GroupStayEmailData): { subject: string; html: string } {
  const currency = data.currency || "TZS";
  const nights = nightCount(data.checkIn, data.checkOut);
  const refCode = data.bookingCode ?? `GS${data.bookingId}`;

  const detailRows: Array<[string, string]> = [];
  if (data.propertyName) detailRows.push(["Property", data.propertyName]);
  if (data.destination) detailRows.push(["Destination", data.destination]);
  detailRows.push(
    ["Check in",        fmtDate(data.checkIn)],
    ["Check out",       fmtDate(data.checkOut)],
    ["Nights",          String(nights)],
    ["Rooms",           String(data.roomsNeeded)],  );

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.guestName}, we are delighted to welcome your group. Your deposit has been received and your group stay is secured. We cannot wait to host you.</p>
    ${proDivider()}
    ${proReferenceCard(
      "Booking reference",
      refCode,
      "Keep this reference for your group stay. Our team uses it for every update and at check-in."
    )}
    ${proDivider()}
    ${proDetailRows("Group stay details", detailRows, ["Deposit paid", fmtMoney(data.depositAmount, currency)])}
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "What happens next", "Our group stays team will be in touch with the remaining arrangements and any balance due before your arrival.")}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions about your group stay? We are happy to help at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Your group stay is confirmed (${refCode})`,
    html: proEmail("Your group stay is confirmed", body),
  };
}

// ─── 7. Owner: new paid booking ───────────────────────────────────────────────

/**
 * Sent to a property owner the moment a guest books and pays for their property
 * (every payment rail, via notifyOwnerInvoicePaid). Lets the owner prepare for
 * the guest instead of only learning at disbursement time.
 */
export interface OwnerNewBookingEmailData {
  ownerName: string;
  propertyName: string;
  guestName?: string;
  checkIn: Date | string;
  checkOut: Date | string;
  roomsQty?: number;
  /** The owner's expected net payout for this booking */
  netPayout?: number | string | null;
  bookingId: number;
  currency?: string;
}

export function getOwnerNewBookingEmail(data: OwnerNewBookingEmailData): { subject: string; html: string } {
  const currency = data.currency || "TZS";
  const nights = nightCount(data.checkIn, data.checkOut);

  const rows: Array<[string, string]> = [["Property", data.propertyName]];
  if (data.guestName) rows.push(["Guest", data.guestName]);
  rows.push(
    ["Check in",       fmtDate(data.checkIn)],
    ["Check out",      fmtDate(data.checkOut)],
    ["Nights",         String(nights)],
    ["Rooms",          String(data.roomsQty ?? 1)],  );

  const payoutBlock =
    data.netPayout != null && Number(data.netPayout) > 0
      ? `${proHighlight("Your expected payout", fmtMoney(data.netPayout, currency), "This will be disbursed to your registered payment method after the guest checks in and the booking code is validated.", BRAND_TEAL)}${proDivider()}`
      : "";

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.ownerName}, good news. A guest has just booked and paid for <strong style="color:#1a1a1a;">${data.propertyName}</strong>. Please get everything ready for their stay.</p>
    ${proDivider()}
    ${payoutBlock}${proDetailRows("Booking details", rows)}
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "What to do next", "Prepare the room for the dates above. The guest will present their booking reference on arrival.")}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `New booking at ${data.propertyName}`,
    html: proEmail("You have a new booking", body),
  };
}

// ─── 8. Operator: new paid tour booking ───────────────────────────────────────

/**
 * Sent to a tour operator the moment a traveler books and pays for their tour
 * (every payment rail, via markTourBookingPaid).
 */
export interface OperatorTourBookedEmailData {
  operatorName: string;
  tourTitle: string;
  destination?: string;
  guestName?: string;
  startDate: Date | string;
  travelerCount: number;
  /** The operator's expected payout for this booking */
  operatorPayout?: number | string | null;
  bookingId: number;
  bookingCode?: string;
  currency?: string;
}

export function getOperatorTourBookedEmail(data: OperatorTourBookedEmailData): { subject: string; html: string } {
  const currency = data.currency || "TZS";

  const RED = "#b42318";
  const RED_BG = "#fdf3f2";

  const rows: Array<[string, string]> = [["Tour", data.tourTitle]];
  if (data.destination) rows.push(["Destination", data.destination]);
  if (data.guestName) rows.push(["Guest", data.guestName]);
  rows.push(
    ["Date",      fmtDate(data.startDate)],
    ["Travelers", String(data.travelerCount)],
  );

  const payoutBlock =
    data.operatorPayout != null && Number(data.operatorPayout) > 0
      ? `${proHighlight("Your expected payout", fmtMoney(data.operatorPayout, currency), "", BRAND_TEAL)}${proDivider()}`
      : "";

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.operatorName}, good news. A traveler has just booked and paid for your tour <strong style="color:#1a1a1a;">${data.tourTitle}</strong>. Please get ready to host them.</p>
    ${proDivider()}
    ${payoutBlock}${proDetailRows("Tour booking", rows)}
    ${proDivider()}
    ${proNoteCard(RED, "Deliver exactly as described", "Honor the full itinerary and timetable you described for this tour. That is what the traveler paid for, and NoLSAF remotely reviews the entire route to confirm the paid service is delivered as planned.", RED_BG)}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Questions? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `New tour booking: ${data.tourTitle}`,
    html: proEmail("You have a new tour booking", body),
  };
}
