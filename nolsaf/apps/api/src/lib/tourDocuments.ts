import { prisma } from "@nolsaf/prisma";

function bookingCodeSuffix(bookingCode: string | null | undefined): string {
  return String(bookingCode || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
}

function formatYmd(value: Date | null | undefined): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return "00000000";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function checksum36(input: string): string {
  let acc = 0;
  for (let index = 0; index < input.length; index += 1) acc += input.charCodeAt(index) * (index + 1);
  return (acc % 36).toString(36).toUpperCase();
}

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isPickupValidated(metadata: unknown): boolean {
  const value = safeObject(metadata);
  const shared = safeObject(value.pickupValidation);
  const operator = safeObject(value.pickupValidationOperator);
  return Boolean(
    shared.validated ||
    shared.firstMeetValidated ||
    shared.validatedAt ||
    operator.validated ||
    operator.validatedAt
  );
}

export function buildTourVoucherIdentity(payload: {
  bookingId: number;
  bookingCode: string | null | undefined;
  startDate: Date | null | undefined;
  travelerCount: number | null | undefined;
}) {
  const suffix = bookingCodeSuffix(payload.bookingCode) || String(payload.bookingId).slice(-6).padStart(6, "0");
  const ymd = formatYmd(payload.startDate);
  const travelerPart = String(Math.max(1, Number(payload.travelerCount || 1))).padStart(2, "0");
  const core = `NLSAF-TVR-${ymd}-${suffix}-${travelerPart}`;
  const check = checksum36(core);
  return {
    voucherNumber: `${core}-${check}`,
    securityMark: `★${suffix}-${check}★`,
    machineLine: `NLSAF|TVR|${payload.bookingId}|${suffix}|${travelerPart}|${check}`,
    issuedAt: new Date().toISOString(),
  };
}

export async function loadTourVoucherDocument(bookingId: number, userId: number) {
  const booking = await prisma.tourBooking.findFirst({
    where: { id: bookingId, customerId: userId },
    select: {
      id: true,
      bookingCode: true,
      title: true,
      destination: true,
      startDate: true,
      endDate: true,
      travelerCount: true,
      guestName: true,
      guestPhone: true,
      packageSnapshot: true,
      operatorSnapshot: true,
      status: true,
      paymentStatus: true,
      metadata: true,
    },
  });
  if (!booking) return { ok: false as const, status: 404, error: "Tour booking not found" };

  const pkg = booking.packageSnapshot && typeof booking.packageSnapshot === "object" && !Array.isArray(booking.packageSnapshot)
    ? (booking.packageSnapshot as Record<string, any>)
    : {};
  const bookingStatus = String(booking.status || "").toUpperCase();
  const paid = ["APPROVED", "PAID", "DISBURSED", "SETTLED"].includes(String(booking.paymentStatus || "").toUpperCase());
  const lastDay = booking.endDate ?? booking.startDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const voucherStatus: "VALID" | "USED" | "EXPIRED" | "UNPAID" | "CANCELLED" =
    ["CANCELED", "CANCELLED", "REFUNDED"].includes(bookingStatus)
      ? "CANCELLED"
      : !paid
        ? "UNPAID"
        : isPickupValidated(booking.metadata) || ["COMPLETED", "OPERATOR_COMPLETED"].includes(bookingStatus)
          ? "USED"
          : lastDay && new Date(lastDay).getTime() < today.getTime()
            ? "EXPIRED"
            : "VALID";
  return {
    ok: true as const,
    data: {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      voucherIdentity: buildTourVoucherIdentity({
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        startDate: booking.startDate,
        travelerCount: booking.travelerCount,
      }),
      voucherStatus,
      title: booking.title,
      destination: booking.destination,
      startDate: booking.startDate,
      endDate: booking.endDate,
      travelerCount: booking.travelerCount,
      guestName: booking.guestName,
      guestPhone: booking.guestPhone,
      operatorSnapshot: booking.operatorSnapshot || null,
      itinerary: Array.isArray(pkg.itinerary) ? pkg.itinerary : [],
      meetingPoints: Array.isArray(pkg.meetingPoints) ? pkg.meetingPoints : (pkg.meetingPoint ? [pkg.meetingPoint] : []),
      inclusions: Array.isArray(pkg.inclusions) ? pkg.inclusions : [],
    },
  };
}

export async function loadTourReceiptDocument(bookingId: number, userId: number) {
  const booking = await prisma.tourBooking.findFirst({
    where: { id: bookingId, customerId: userId },
    select: {
      id: true,
      bookingCode: true,
      title: true,
      currency: true,
      grossAmount: true,
      paymentStatus: true,
      paymentProvider: true,
      paymentRef: true,
      paidAt: true,
      travelerCount: true,
      guestName: true,
    },
  });
  if (!booking) return { ok: false as const, status: 404, error: "Tour booking not found" };

  const paymentStatus = String(booking.paymentStatus || "").toUpperCase();
  if (!["PAID", "APPROVED", "DISBURSED", "SETTLED"].includes(paymentStatus)) {
    return {
      ok: false as const,
      status: 409,
      error: "receipt_not_available",
      message: "Receipt is available after successful payment.",
    };
  }

  return {
    ok: true as const,
    data: {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      title: booking.title,
      currency: booking.currency,
      amount: Number(booking.grossAmount || 0),
      paymentStatus: booking.paymentStatus,
      paymentProvider: booking.paymentProvider,
      paymentRef: booking.paymentRef,
      paidAt: booking.paidAt,
      travelerCount: booking.travelerCount,
      guestName: booking.guestName,
    },
  };
}
