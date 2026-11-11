// apps/api/src/lib/bookingInsights.ts
//
// Booking funnel for one property or one property type: every booking placed
// in the window (tried), how many reached payment, and how each one ended.
// Pure so it can be tested without a database. The stored booking/invoice
// statuses stay authoritative; unpaid NEW bookings are classified with the
// same rules the admin bookings list uses (classifyBookingAttempt).

import { classifyBookingAttempt } from "./bookingAttemptState.js";
import { channelOf } from "./gatewayFees.js";

export type BookingOutcome = "RECEIVED" | "PAYING" | "NOT_PAID" | "CANCELLED";

export type InsightBooking = {
  id: number;
  propertyId: number;
  status: string;
  createdAt: Date;
  checkIn: Date;
  checkOut: Date;
  totalAmount: unknown;
  invoices: Array<{
    status: string;
    receiptNumber?: string | null;
    commissionAmount?: unknown;
    paymentMethod?: string | null;
    paymentEvents?: Array<{ status: string }>;
  }>;
};

const RECEIVED_STATUSES = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);
const CANCELLED_STATUSES = new Set(["CANCELED", "CANCELLED"]);
const COMMISSION_INVOICE_STATUSES = new Set(["APPROVED", "PAID"]);
const DAY_MS = 86_400_000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Dar_es_Salaam, no DST

export function eatDayKey(at: Date | number): string {
  return new Date(new Date(at).getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function classifyInsightBooking(booking: InsightBooking, now: Date) {
  const status = String(booking.status || "").toUpperCase();
  const invoices = booking.invoices ?? [];
  const failedPayment = invoices.some((inv) =>
    (inv.paymentEvents ?? []).some((event) => String(event.status).toUpperCase() === "FAILED"));

  let outcome: BookingOutcome;
  let needsReview = false;
  if (RECEIVED_STATUSES.has(status)) outcome = "RECEIVED";
  else if (CANCELLED_STATUSES.has(status)) outcome = "CANCELLED";
  else {
    const attempt = classifyBookingAttempt(booking as any, now);
    if (!attempt) outcome = "PAYING";
    else if (attempt.state === "ABANDONED" || attempt.state === "EXPIRED_UNPAID") outcome = "NOT_PAID";
    else {
      outcome = "PAYING";
      needsReview = attempt.needsReview;
    }
  }

  return {
    outcome,
    reachedPayment: outcome === "RECEIVED" || invoices.length > 0,
    paymentFailed: failedPayment && outcome !== "RECEIVED",
    needsReview,
  };
}

type Counts = { tried: number; received: number };

export function summarizeBookingInsights(bookings: InsightBooking[], opts: { now: Date; days: number }) {
  const { now, days } = opts;
  const since = new Date(now.getTime() - days * DAY_MS);
  const previousSince = new Date(now.getTime() - 2 * days * DAY_MS);

  // One column per EAT day in the window, oldest first, so empty days still show.
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(eatDayKey(now.getTime() - i * DAY_MS));
  const daily = new Map(dayKeys.map((day) => [day, { day, received: 0, paying: 0, notPaid: 0, cancelled: 0 }]));

  const totals = {
    tried: 0, reachedPayment: 0, received: 0, paying: 0, notPaid: 0, cancelled: 0,
    paymentFailed: 0, needsReview: 0, receivedValue: 0, commission: 0,
  };
  const previous: Counts = { tried: 0, received: 0 };
  const channels = new Map<string, number>();
  const byProperty = new Map<number, Counts>();
  let nightsSum = 0;
  let leadSum = 0;
  const classified: Array<{ booking: InsightBooking; outcome: BookingOutcome }> = [];

  for (const booking of bookings) {
    const created = new Date(booking.createdAt);
    if (created < previousSince || created > now) continue;
    const c = classifyInsightBooking(booking, now);

    if (created < since) {
      previous.tried += 1;
      if (c.outcome === "RECEIVED") previous.received += 1;
      continue;
    }

    classified.push({ booking, outcome: c.outcome });
    totals.tried += 1;
    if (c.reachedPayment) totals.reachedPayment += 1;
    if (c.paymentFailed) totals.paymentFailed += 1;
    if (c.needsReview) totals.needsReview += 1;

    const perProperty = byProperty.get(booking.propertyId) ?? { tried: 0, received: 0 };
    perProperty.tried += 1;

    const bucket = daily.get(eatDayKey(created));
    if (c.outcome === "RECEIVED") {
      totals.received += 1;
      perProperty.received += 1;
      totals.receivedValue += money(booking.totalAmount);
      for (const inv of booking.invoices ?? []) {
        if (COMMISSION_INVOICE_STATUSES.has(String(inv.status).toUpperCase())) totals.commission += money(inv.commissionAmount);
      }
      const method = (booking.invoices ?? []).find((inv) => inv.paymentMethod)?.paymentMethod;
      const channel = method ? channelOf(method) : "NOT_RECORDED";
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
      nightsSum += Math.max(1, Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / DAY_MS));
      leadSum += Math.max(0, Math.round((new Date(booking.checkIn).getTime() - created.getTime()) / DAY_MS));
      if (bucket) bucket.received += 1;
    } else if (c.outcome === "CANCELLED") {
      totals.cancelled += 1;
      if (bucket) bucket.cancelled += 1;
    } else if (c.outcome === "NOT_PAID") {
      totals.notPaid += 1;
      if (bucket) bucket.notPaid += 1;
    } else {
      totals.paying += 1;
      if (bucket) bucket.paying += 1;
    }
    byProperty.set(booking.propertyId, perProperty);
  }

  return {
    window: { days, from: since.toISOString(), to: now.toISOString() },
    totals: {
      ...totals,
      receivedValue: Math.round(totals.receivedValue),
      commission: Math.round(totals.commission),
      conversion: totals.tried > 0 ? totals.received / totals.tried : null,
      avgNights: totals.received > 0 ? Math.round((nightsSum / totals.received) * 10) / 10 : null,
      avgLeadDays: totals.received > 0 ? Math.round(leadSum / totals.received) : null,
    },
    previous,
    daily: dayKeys.map((day) => daily.get(day)!),
    channels: [...channels.entries()]
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count),
    byProperty,
    classified,
  };
}
