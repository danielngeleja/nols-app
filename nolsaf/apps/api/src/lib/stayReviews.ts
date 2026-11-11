/**
 * Guest reviews of a stay.
 *
 * Only a guest who actually stayed can review a property, and every review is
 * tied to the booking it came from, so each one shows as a verified stay.
 *
 * A stay counts as finished when the property checked the guest out, or when a
 * paid booking's check-out date has passed. The second rule matters for NRMS
 * properties, whose front desk never flips the marketplace booking to
 * CHECKED_OUT, and for owners who forget to press check-out.
 *
 * After a stay ends the guest is asked once (in-app, plus email when their
 * address is verified) to rate it. The prompt is never sent twice for the same
 * booking and never sent to a guest who already reviewed the property.
 */
import { prisma } from "@nolsaf/prisma";
import { notifyOwner } from "./notifications.js";
import { sendMail } from "./mailer.js";
import { BRAND_TEAL, proButton, proDivider, proEmail } from "./emailBase.js";
import { NRMS_REVIEW_CATEGORY_KEYS, sanitiseCategoryRatings } from "./nrmsReviewCategories.js";
import { customerBookingReference } from "./customerBookingReference.js";
import { webOrigin } from "./salesPartnerCard.js";

const DAY = 24 * 60 * 60 * 1000;
/** Stays that ended longer ago than this are not prompted by the sweep. */
const PROMPT_WINDOW_DAYS = 3;

export class StayReviewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type StayLike = { status: string; checkOut: Date | string; code?: unknown };

/** True once the guest has finished this stay and may review it. */
export function isFinishedStay(booking: StayLike, now = new Date()): boolean {
  const status = String(booking.status || "").toUpperCase();
  if (status === "CHECKED_OUT") return true;
  if (status !== "CONFIRMED" && status !== "CHECKED_IN") return false;
  // Paid bookings carry a check-in code; an unpaid one never counts as a stay.
  if (!booking.code) return false;
  return new Date(booking.checkOut).getTime() <= now.getTime();
}

/** Prisma filter matching isFinishedStay, for queries. */
export function finishedStayWhere(now = new Date()) {
  return {
    OR: [
      { status: "CHECKED_OUT" },
      { status: { in: ["CONFIRMED", "CHECKED_IN"] }, code: { isNot: null }, checkOut: { lte: now } },
    ],
  };
}

export type StayReviewInput = {
  rating: number;
  title?: string | null;
  comment?: string | null;
  categoryRatings?: unknown;
};

/** What a guest sees about their own review of a stay. */
export function guestReviewView(row: any) {
  if (!row) return null;
  return {
    rating: row.rating,
    title: row.title ?? null,
    comment: row.comment ?? null,
    categoryRatings: row.categoryRatings ?? null,
    createdAt: row.createdAt,
    ownerResponse: row.isHidden ? null : row.ownerResponse ?? null,
    ownerResponseAt: row.isHidden ? null : row.ownerResponseAt ?? null,
    hidden: Boolean(row.isHidden),
  };
}

export const guestReviewSelect = {
  id: true,
  propertyId: true,
  rating: true,
  title: true,
  comment: true,
  categoryRatings: true,
  createdAt: true,
  ownerResponse: true,
  ownerResponseAt: true,
  isHidden: true,
};

/**
 * Save a guest's review of one finished stay. The caller has already proved
 * the booking belongs to this user.
 */
export async function createStayReview(input: {
  userId: number;
  booking: { id: number; propertyId: number; status: string; checkOut: Date | string; code?: unknown };
  review: StayReviewInput;
}) {
  const { userId, booking, review } = input;
  if (!isFinishedStay(booking)) {
    throw new StayReviewError(403, "You can rate this stay once you have checked out.");
  }

  const property = await prisma.property.findFirst({
    where: { id: booking.propertyId },
    select: { id: true, ownerId: true, title: true },
  });
  if (!property) throw new StayReviewError(404, "Property not found");
  if (property.ownerId === userId) {
    throw new StayReviewError(403, "Property owners cannot leave reviews on their own properties");
  }

  // One review per guest per property, the rule the public page already used.
  const existing = await prisma.propertyReview.findFirst({ where: { propertyId: property.id, userId }, select: { id: true } });
  if (existing) throw new StayReviewError(409, "You have already reviewed this property");

  const title = review.title?.trim() || null;
  const comment = review.comment?.trim() || null;
  const created = await prisma.propertyReview.create({
    data: {
      propertyId: property.id,
      userId,
      rating: review.rating,
      title,
      comment,
      categoryRatings: sanitiseCategoryRatings(review.categoryRatings, NRMS_REVIEW_CATEGORY_KEYS) ?? undefined,
      bookingId: booking.id,
      isVerified: true,
      isPublished: true,
      isHidden: false,
    },
    select: { ...guestReviewSelect, user: { select: { id: true, name: true } } },
  });

  // Tell the owner so they can reply. Best effort: the review is already saved.
  if (property.ownerId) {
    void notifyOwner(property.ownerId, "property_review_received", {
      propertyTitle: property.title,
      rating: created.rating,
    }).catch(() => undefined);
  }

  return created;
}

/** The guest's most recent finished stay at a property, if any. */
export async function findFinishedStay(userId: number, propertyId: number, now = new Date()) {
  return prisma.booking.findFirst({
    where: { userId, propertyId, ...finishedStayWhere(now) },
    select: { id: true, propertyId: true, status: true, checkOut: true, code: { select: { id: true } } },
    orderBy: { checkOut: "desc" },
  });
}

function reviewKey(bookingId: number) {
  return `stay-review:${bookingId}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function getStayReviewRequestEmail(data: { guestName: string; propertyName: string; reviewUrl: string }) {
  const guest = escapeHtml(data.guestName);
  const property = escapeHtml(data.propertyName);
  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${guest}, thank you for staying at <strong style="color:#1a1a1a;">${property}</strong>. We hope it went well.</p>
    <p style="margin:14px 0 0;color:#4b5563;">Would you take a minute to rate your stay? Your review helps other travellers choose, and helps ${property} know what to keep and what to improve.</p>
    ${proDivider()}
    ${proButton(data.reviewUrl, "Rate your stay")}
    <p style="margin:14px 0 0;color:#6b7280;font-size:13px;">It takes less than a minute. Your review is shown with your first name and the first letter of your last name only.</p>
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Something went wrong during your stay? Tell us at <a href="mailto:bookings@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">bookings@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warmly,<br><strong>The NoLSAF Team</strong></p>
  `;
  return {
    subject: `How was your stay at ${data.propertyName}?`,
    html: proEmail("How was your stay?", body),
  };
}

/**
 * Ask the guest to rate a finished stay. Safe to call more than once and from
 * several places: it sends nothing for an unfinished stay, a guest without an
 * account, a property they already reviewed, or a booking already prompted.
 */
export async function askGuestToReview(bookingId: number, now = new Date()): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      propertyId: true,
      status: true,
      checkOut: true,
      guestName: true,
      code: { select: { id: true } },
      property: { select: { title: true, ownerId: true } },
      user: { select: { id: true, name: true, email: true, emailVerifiedAt: true, notificationPreferences: true } },
    },
  });
  if (!booking?.userId || !booking.user) return false;
  if (!isFinishedStay(booking, now)) return false;
  if (booking.property?.ownerId === booking.userId) return false;

  const preferences = booking.user.notificationPreferences && typeof booking.user.notificationPreferences === "object" && !Array.isArray(booking.user.notificationPreferences)
    ? (booking.user.notificationPreferences as Record<string, unknown>)
    : {};
  if (preferences.bookings === false) return false;

  const [reviewed, prompted] = await Promise.all([
    prisma.propertyReview.findFirst({ where: { propertyId: booking.propertyId, userId: booking.userId }, select: { id: true } }),
    prisma.notification.findFirst({
      where: { userId: booking.userId, meta: { path: "$.reminderKey", equals: reviewKey(booking.id) } as any },
      select: { id: true },
    }),
  ]);
  if (reviewed || prompted) return false;

  const propertyName = booking.property?.title || "your stay";
  const reference = customerBookingReference(booking.id);
  const path = `/account/bookings/${reference}#rate`;

  const created = await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: "How was your stay?",
      body: `Thank you for staying at ${propertyName}. Rate your stay to help other travellers and the host.`,
      type: "booking",
      unread: true,
      meta: {
        notificationKind: "stay_review_request",
        reminderKey: reviewKey(booking.id),
        bookingReference: reference,
        propertyTitle: propertyName,
        actionUrl: path,
        serviceKind: "STAY",
        action: { screen: "MyBookings", params: { bookingReference: reference } },
      },
    },
  });
  try {
    const io = (global as any).io;
    if (io && typeof io.to === "function") {
      io.to(`user:${booking.userId}`).emit("notification:new", { id: created.id, userId: booking.userId, type: created.type, title: created.title, body: created.body, createdAt: created.createdAt });
    }
  } catch {
    // realtime is best effort
  }

  if (booking.user.email && booking.user.emailVerifiedAt) {
    try {
      const { subject, html } = getStayReviewRequestEmail({
        guestName: booking.guestName || booking.user.name || "there",
        propertyName,
        reviewUrl: `${webOrigin()}${path}`,
      });
      await sendMail(booking.user.email, subject, html);
    } catch (error: any) {
      console.warn("[stayReviews] review request email failed", booking.id, error?.message || error);
    }
  }
  return true;
}

/**
 * Sweep for stays that ended without a check-out press (NRMS properties, or an
 * owner who forgot). Only recent stays are prompted, so turning this on never
 * mails guests about trips from months ago.
 */
export async function runStayReviewPrompts(now = new Date()) {
  const since = new Date(now.getTime() - PROMPT_WINDOW_DAYS * DAY);
  const candidates = await prisma.booking.findMany({
    where: {
      userId: { not: null },
      checkOut: { gte: since, lte: now },
      ...finishedStayWhere(now),
    },
    select: { id: true },
    orderBy: { checkOut: "asc" },
    take: 200,
  });
  let sent = 0;
  for (const { id } of candidates) {
    try {
      if (await askGuestToReview(id, now)) sent += 1;
    } catch (error: any) {
      console.warn("[stayReviews] prompt failed", id, error?.message || error);
    }
  }
  return { candidates: candidates.length, sent };
}

export function startStayReviewPromptWorker({ intervalMs = 30 * 60 * 1000 }: { intervalMs?: number } = {}) {
  if ((global as any).__stayReviewPromptsStarted) return;
  (global as any).__stayReviewPromptsStarted = true;
  const run = () => runStayReviewPrompts().catch((error) => console.error("[stayReviews]", error));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
}
