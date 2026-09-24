// apps/api/src/lib/groupStayReceipts.ts
//
// Builds the PDF receipt for a paid group stay deposit. Shared by the
// authenticated customer download route and the token-based public route
// used by the mobile app's in-browser PDF viewer.

import { prisma } from "@nolsaf/prisma";
import { createHash } from "node:crypto";
import { generateCustomerBookingReceiptPdf } from "./pdfDocuments.js";
import { makeQR } from "./qr.js";

const RECEIPT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function buildGroupStayReceiptNumber(bookingId: number, paidAt: Date, paymentRef: string | null): string {
  const seed = `${bookingId}:${paidAt.toISOString()}:${paymentRef || "NOLSAF"}`;
  const digest = createHash("sha256").update(seed).digest();
  let code = "";
  for (let i = 0; i < 6; i += 1) code += RECEIPT_CODE_ALPHABET[digest[i] % RECEIPT_CODE_ALPHABET.length];
  return `NGST-${code}-${bookingId}-${paidAt.getFullYear()}`;
}

export type GroupStayDepositReceiptResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; status: number; error: string; message: string };

export type GroupStayDepositReceiptDataResult =
  | { ok: true; receipt: {
      bookingId: number;
      receiptNumber: string;
      guestName: string;
      guestEmail: string | null;
      propertyName: string;
      destination: string;
      checkIn: Date;
      checkOut: Date;
      bookingTotal: number;
      depositPaid: number;
      remainingBalance: number;
      currency: string;
      paymentMethod: string;
      paymentRef: string | null;
      paidAt: Date;
      headcount: number | null;
      roomsNeeded: number | null;
      accommodationType: string | null;
      /** True when the booking has real stay dates (checkIn/checkOut fall back to paidAt otherwise). */
      hasDates: boolean;
    } }
  | { ok: false; status: number; error: string; message: string };

export async function loadGroupStayDepositReceiptData(bookingId: number, userId: number): Promise<GroupStayDepositReceiptDataResult> {
  const booking = await prisma.groupBooking.findFirst({
    where: { id: bookingId, userId },
    select: {
      id: true, toRegion: true, toDistrict: true, checkIn: true, checkOut: true,
      totalAmount: true, depositAmount: true, ownerAmount: true, depositPaid: true, depositPaidAt: true,
      currency: true, paymentRef: true, paymentProvider: true,
      headcount: true, roomsNeeded: true, accommodationType: true,
      confirmedProperty: { select: { title: true } },
      user: { select: { name: true, fullName: true, email: true } },
    },
  });

  if (!booking) return { ok: false, status: 404, error: "not_found", message: "Group booking not found or access denied" };
  if (!booking.depositPaid || !booking.depositPaidAt) return { ok: false, status: 400, error: "deposit_not_paid", message: "No deposit payment has been recorded for this booking yet." };

  const paidAt = new Date(booking.depositPaidAt);
  const depositPaid = Number(booking.depositAmount || 0);
  const bookingTotal = Number(booking.totalAmount || 0);
  const remainingBalance = Number(booking.ownerAmount ?? Math.max(0, bookingTotal - depositPaid));
  const destination = [booking.toDistrict, booking.toRegion].filter(Boolean).join(", ");

  return { ok: true, receipt: {
    bookingId: booking.id,
    receiptNumber: buildGroupStayReceiptNumber(booking.id, paidAt, booking.paymentRef || null),
    guestName: booking.user?.fullName || booking.user?.name || booking.user?.email || "Guest",
    guestEmail: booking.user?.email || null,
    propertyName: booking.confirmedProperty?.title || destination || "Group stay accommodation",
    destination,
    checkIn: booking.checkIn || paidAt,
    checkOut: booking.checkOut || paidAt,
    bookingTotal,
    depositPaid,
    remainingBalance,
    currency: booking.currency || "TZS",
    paymentMethod: booking.paymentProvider || "AZAMPAY",
    paymentRef: booking.paymentRef || null,
    paidAt,
    headcount: booking.headcount ?? null,
    roomsNeeded: booking.roomsNeeded ?? null,
    accommodationType: booking.accommodationType ?? null,
    hasDates: Boolean(booking.checkIn && booking.checkOut),
  } };
}

type GroupStayReceipt = Extract<GroupStayDepositReceiptDataResult, { ok: true }>["receipt"];

/**
 * The wording of a group stay deposit receipt, shared by the HTML receipt
 * (pdfGenerator) and the vector PDF (pdfDocuments) so both read the same.
 */
export function describeGroupStayDeposit(receipt: GroupStayReceipt) {
  const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
  const nights = receipt.hasDates
    ? Math.max(1, Math.round((receipt.checkOut.getTime() - receipt.checkIn.getTime()) / 86_400_000))
    : null;
  const guests = Number(receipt.headcount || 0);
  const rooms = Number(receipt.roomsNeeded || 0);
  const kind = receipt.accommodationType
    ? receipt.accommodationType.charAt(0).toUpperCase() + receipt.accommodationType.slice(1).toLowerCase()
    : "Group accommodation";
  const pct = receipt.bookingTotal > 0 ? Math.round((receipt.depositPaid / receipt.bookingTotal) * 100) : null;
  const stayFacts = [
    nights ? `${nights} night${nights === 1 ? "" : "s"}` : null,
    guests > 0 ? `${guests} guest${guests === 1 ? "" : "s"}` : null,
    rooms > 0 ? `${rooms} room${rooms === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" | ");
  const share = pct != null
    ? `${pct}% of ${Math.round(receipt.bookingTotal).toLocaleString("en-US")} ${receipt.currency}`
    : null;
  return {
    kind,
    location: receipt.destination ? `${receipt.destination}, Tanzania` : "Tanzania",
    periodLong: receipt.hasDates ? `${longDate(receipt.checkIn)} to ${longDate(receipt.checkOut)}` : "Dates to be confirmed",
    periodShort: receipt.hasDates ? `${shortDate(receipt.checkIn)} - ${shortDate(receipt.checkOut)}` : "Dates to be confirmed",
    stayFacts,
    share,
    lineTitle: "Group stay deposit",
    confirmationCopy: "Your group stay is confirmed. The balance is payable as agreed in your booking. This document is not a fiscal tax receipt.",
  };
}

export async function loadGroupStayDepositReceipt(bookingId: number, userId: number): Promise<GroupStayDepositReceiptResult> {
  const result = await loadGroupStayDepositReceiptData(bookingId, userId);
  if (!result.ok) return result;
  const receipt = result.receipt;

  const d = describeGroupStayDeposit(receipt);
  const qr = await makeQR(JSON.stringify({
    type: "NOLSAF_GROUP_STAY_DEPOSIT_RECEIPT",
    receiptNumber: receipt.receiptNumber,
    paymentRef: receipt.paymentRef,
    amount: receipt.depositPaid,
    currency: receipt.currency,
  })).catch(() => null);

  // Same A5 document as the stay and tour receipts, worded for a deposit
  const buffer = await generateCustomerBookingReceiptPdf({
    receiptNumber: receipt.receiptNumber,
    invoiceNumber: null,
    bookingCode: receipt.paymentRef || receipt.receiptNumber,
    paidAt: receipt.paidAt,
    guestName: receipt.guestName,
    guestPhone: receipt.guestEmail,
    propertyName: receipt.propertyName,
    propertyLocation: [d.kind, d.location].join(" | "),
    checkIn: receipt.checkIn,
    checkOut: receipt.checkOut,
    totalAmount: receipt.depositPaid,
    currency: receipt.currency,
    qrPng: qr?.png ?? null,
    document: {
      title: "DEPOSIT RECEIPT",
      reservationLabel: "GROUP STAY",
      periodLabel: "STAY",
      periodText: d.periodShort,
      lineTitle: d.lineTitle,
      lineSub: [d.share, d.stayFacts].filter(Boolean).join(" | "),
      balanceDue: receipt.remainingBalance,
      confirmationCopy: d.confirmationCopy,
    },
  });

  return { ok: true, buffer, filename: `Group-Stay-Deposit-Receipt-${receipt.bookingId}.pdf` };
}
