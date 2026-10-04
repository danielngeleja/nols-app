/**
 * Twiga grounding.
 *
 * Turns a generic answer into one about the caller's own records. "Where is my
 * booking" should say which booking and what state it is in, not recite where
 * the menu item lives.
 *
 * Rules this module holds to, without exception:
 *
 *   1. Read only. Nothing here writes, and nothing here is reachable by a
 *      caller who is not signed in.
 *   2. Every query is scoped by the caller's own id. No grounder takes an
 *      identifier from the utterance, so there is nothing for a visitor to
 *      point at someone else's data.
 *   3. Only the caller's own information is returned. Never a guest's name, a
 *      phone number, or anything belonging to a third party.
 *   4. A failure is silent. If a lookup throws or times out, the caller still
 *      gets the static answer rather than an error, because a support bot that
 *      breaks when the database hiccups is worse than a vague one.
 */

import { prisma } from "@nolsaf/prisma";

export interface GroundingContext {
  userId: number;
  role: string | null;
}

/** Returns a short personalised paragraph, or null when there is nothing useful to say. */
type Grounder = (ctx: GroundingContext) => Promise<string | null>;

/** How long a grounder may take before we fall back to the static answer. */
const GROUNDING_TIMEOUT_MS = 2500;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formatted by hand rather than through toLocaleDateString, whose output
 * depends on the ICU data built into the running Node (the same call renders
 * "Sep" or "Sept" depending on the build). Guest-facing copy should not change
 * shape because of the deployment environment.
 */
function formatDate(value: Date): string {
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfTomorrow(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Mirrors the visibility rule in routes/owner.revenue.ts, so what Twiga counts
 * is exactly what the owner sees on their own revenue pages. If that rule
 * changes, this has to change with it.
 */
function revenueVisibilityClause() {
  return {
    OR: [
      { invoiceNumber: { startsWith: "OINV-" } },
      { AND: [{ invoiceNumber: { startsWith: "INV-" } }, { status: "PAID" }] },
    ],
  };
}

// ─── Customer grounders ────────────────────────────────────────────────────

const groundBookingStatus: Grounder = async ({ userId }) => {
  // Scoped strictly to bookings owned by this account. The customer bookings
  // route additionally matches legacy rows on a phone-number tail; that is
  // deliberately not done here, because a tail collision would show one
  // person's stay to another, which is not a risk worth taking for a chat reply.
  const bookings = await prisma.booking.findMany({
    where: { userId, status: { in: ["NEW", "CONFIRMED", "CHECKED_IN"] } },
    orderBy: { checkIn: "asc" },
    take: 3,
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      property: { select: { title: true } },
    },
  });

  if (bookings.length === 0) return null;

  const lines = bookings.map((b) => {
    const where = b.property?.title ?? "your booking";
    const dates = `${formatDate(b.checkIn)} to ${formatDate(b.checkOut)}`;
    if (b.status === "NEW") {
      return `${where}, ${dates}, not paid for yet`;
    }
    if (b.status === "CHECKED_IN") {
      return `${where}, checked in, due out ${formatDate(b.checkOut)}`;
    }
    return `${where}, ${dates}, confirmed`;
  });

  const unpaid = bookings.filter((b) => b.status === "NEW").length;
  const tail = unpaid > 0
    ? "\n\nAnything marked not paid for yet will not be held indefinitely, so complete the payment to confirm it."
    : "";

  return `Looking at your account, you have ${plural(bookings.length, "active booking", "active bookings")}:\n${lines
    .map((l) => `- ${l}`)
    .join("\n")}${tail}`;
};

const groundCancellation: Grounder = async ({ userId }) => {
  const count = await prisma.booking.count({
    where: { userId, status: { in: ["NEW", "CONFIRMED"] }, checkIn: { gte: startOfToday() } },
  });

  if (count === 0) {
    return "Looking at your account, you do not have any upcoming bookings that can still be cancelled.";
  }
  return `Looking at your account, you have ${plural(count, "upcoming booking", "upcoming bookings")} you can still cancel or change.`;
};

// ─── Owner grounders ───────────────────────────────────────────────────────

const groundListingApproval: Grounder = async ({ userId }) => {
  const [pending, approved, rejected] = await Promise.all([
    prisma.property.findMany({
      where: { ownerId: userId, status: { in: ["PENDING", "DRAFT"] } },
      select: { title: true, status: true },
      take: 5,
      orderBy: { id: "desc" },
    }),
    prisma.property.count({ where: { ownerId: userId, status: "APPROVED" } }),
    prisma.property.count({ where: { ownerId: userId, status: "REJECTED" } }),
  ]);

  if (pending.length === 0 && approved === 0 && rejected === 0) return null;

  const parts: string[] = [];
  if (approved > 0) parts.push(`${plural(approved, "property", "properties")} approved and live`);
  if (pending.length > 0) parts.push(`${plural(pending.length, "waiting", "waiting")} on review`);
  if (rejected > 0) parts.push(`${plural(rejected, "rejected", "rejected")}`);

  let text = `Looking at your account: ${parts.join(", ")}.`;

  const drafts = pending.filter((p) => p.status === "DRAFT");
  if (drafts.length > 0) {
    text +=
      `\n\n${plural(drafts.length, "listing is", "listings are")} still a draft, which means ` +
      "it has not been submitted for review yet. Nothing happens to a draft until you submit it: " +
      drafts.map((p) => p.title).join(", ") + ".";
  }

  const submitted = pending.filter((p) => p.status === "PENDING");
  if (submitted.length > 0) {
    text += `\n\nAwaiting review: ${submitted.map((p) => p.title).join(", ")}.`;
  }

  return text;
};

const groundPayouts: Grounder = async ({ userId }) => {
  const visibility = revenueVisibilityClause();

  const [inProgress, paid, rejected, oldest] = await Promise.all([
    prisma.invoice.count({
      where: {
        ownerId: userId,
        status: { in: ["REQUESTED", "VERIFIED", "APPROVED", "PROCESSING"] },
        ...visibility,
      },
    }),
    prisma.invoice.count({ where: { ownerId: userId, status: "PAID", ...visibility } }),
    prisma.invoice.count({ where: { ownerId: userId, status: "REJECTED", ...visibility } }),
    prisma.invoice.findFirst({
      where: {
        ownerId: userId,
        status: { in: ["REQUESTED", "VERIFIED", "APPROVED", "PROCESSING"] },
        ...visibility,
      },
      orderBy: { issuedAt: "asc" },
      select: { issuedAt: true },
    }),
  ]);

  if (inProgress === 0 && paid === 0 && rejected === 0) return null;

  const parts: string[] = [];
  if (inProgress > 0) parts.push(`${plural(inProgress, "payout", "payouts")} in progress`);
  if (paid > 0) parts.push(`${plural(paid, "paid", "paid")}`);
  if (rejected > 0) parts.push(`${plural(rejected, "rejected", "rejected")}`);

  let text = `Looking at your account: ${parts.join(", ")}.`;

  if (oldest) {
    text += ` The oldest one still in progress was raised on ${formatDate(oldest.issuedAt)}.`;
  }
  if (rejected > 0) {
    text += "\n\nOpen the rejected ones to see the reason. Most are resubmitted once the reason is addressed.";
  }

  return text;
};

const groundOwnerToday: Grounder = async ({ userId }) => {
  const from = startOfToday();
  const to = startOfTomorrow();
  const scope = { property: { ownerId: userId } };

  const [arriving, departing, inHouse] = await Promise.all([
    prisma.booking.count({
      where: { ...scope, status: "CONFIRMED", checkIn: { gte: from, lt: to } },
    }),
    prisma.booking.count({
      where: { ...scope, status: "CHECKED_IN", checkOut: { gte: from, lt: to } },
    }),
    prisma.booking.count({ where: { ...scope, status: "CHECKED_IN" } }),
  ]);

  if (arriving === 0 && departing === 0 && inHouse === 0) return null;

  return (
    `Across your properties today: ${plural(arriving, "arrival", "arrivals")}, ` +
    `${plural(departing, "departure", "departures")}, and ${plural(inHouse, "guest", "guests")} currently in house.`
  );
};

// ─── Registry ──────────────────────────────────────────────────────────────

/** Entry id to the lookup that personalises it. Anything absent stays generic. */
const GROUNDERS: Record<string, { grounder: Grounder; ownerOnly?: boolean }> = {
  "booking-status": { grounder: groundBookingStatus },
  "cancellation-refund": { grounder: groundCancellation },
  "owner-listing-approval": { grounder: groundListingApproval, ownerOnly: true },
  "owner-payouts": { grounder: groundPayouts, ownerOnly: true },
  "owner-bookings-checkin": { grounder: groundOwnerToday, ownerOnly: true },
};

export function hasGrounder(entryId: string | null): boolean {
  return entryId !== null && entryId in GROUNDERS;
}

/**
 * Look up the caller's own records for this intent.
 *
 * Returns null whenever grounding is unavailable, unauthorised, slow, or has
 * nothing to report, and the caller then falls back to the static answer.
 */
export async function ground(
  entryId: string | null,
  ctx: GroundingContext | null
): Promise<string | null> {
  if (!entryId || !ctx || !Number.isInteger(ctx.userId) || ctx.userId <= 0) return null;

  const registered = GROUNDERS[entryId];
  if (!registered) return null;
  if (registered.ownerOnly && ctx.role !== "OWNER") return null;

  try {
    // A slow query must not hold up the reply.
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), GROUNDING_TIMEOUT_MS).unref?.()
    );
    return await Promise.race([registered.grounder(ctx), timeout]);
  } catch (error) {
    console.warn(`[twiga] grounding failed for "${entryId}":`, error);
    return null;
  }
}
