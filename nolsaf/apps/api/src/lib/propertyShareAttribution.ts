import { prisma } from "@nolsaf/prisma";

/**
 * Attributes a registration to the property share that brought the person in.
 *
 * Kept deliberately separate from `User.referredBy`. A referral link is an
 * explicit invite to join NoLSAF; a property share is a forwarded listing. They
 * answer different questions, so a share never overwrites a referral and the
 * two can both be recorded for the same signup without competing.
 *
 * Rules, all enforced here rather than at the call site:
 *
 * - **30 day window.** A share opened long ago did not cause today's signup.
 * - **No self attribution.** A sharer registering through their own link is not
 *   a referral.
 * - **Last touch.** When several shares of the same property reached one
 *   person, the most recent unattributed one gets the credit.
 * - **Write once.** A share that already named a registrant keeps it.
 *
 * Never throws. Attribution is bookkeeping and must not fail a registration.
 */
const ATTRIBUTION_WINDOW_DAYS = 30;

export async function attributePropertyShare(
  rawToken: unknown,
  registeredUserId: number,
): Promise<boolean> {
  const token = String(rawToken || "").trim();
  if (!/^[a-z2-9]{16}$/.test(token)) return false;

  try {
    const share = await prisma.propertyShare.findUnique({
      where: { token },
      select: {
        id: true,
        sharerId: true,
        propertyId: true,
        createdAt: true,
        revokedAt: true,
        registeredUserId: true,
      },
    });

    if (!share) return false;
    if (share.revokedAt) return false;
    if (share.registeredUserId) return false;
    if (share.sharerId === registeredUserId) return false;

    const ageMs = Date.now() - new Date(share.createdAt).getTime();
    if (ageMs > ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000) return false;

    // Last touch: if this person already came through a newer share of the same
    // property, that one owns the signup.
    const newer = await prisma.propertyShare.findFirst({
      where: {
        propertyId: share.propertyId,
        registeredUserId,
        createdAt: { gt: share.createdAt },
      },
      select: { id: true },
    });
    if (newer) return false;

    const updated = await prisma.propertyShare.updateMany({
      // The registeredUserId guard makes this safe against two concurrent
      // registrations racing for the same token.
      where: { id: share.id, registeredUserId: null },
      data: { registeredUserId, registeredAt: new Date() },
    });

    return updated.count > 0;
  } catch (error) {
    console.warn("Property share attribution failed", error);
    return false;
  }
}

/**
 * Attributes a booking to the share that introduced the customer to the
 * property. Only a share that already owns this customer's registration can
 * claim the booking, so a link cannot claim a customer it never brought in.
 */
export async function attributePropertyShareBooking(
  registeredUserId: number,
  propertyId: number,
  bookingId: number,
): Promise<boolean> {
  try {
    const updated = await prisma.propertyShare.updateMany({
      where: { registeredUserId, propertyId, bookingId: null, revokedAt: null },
      data: { bookingId, convertedAt: new Date() },
    });
    return updated.count > 0;
  } catch (error) {
    console.warn("Property share booking attribution failed", error);
    return false;
  }
}
