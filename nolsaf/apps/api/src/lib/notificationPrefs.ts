import { prisma } from "@nolsaf/prisma";

/**
 * A person's message choices (User.notificationPrefs). Marketing is opt-in:
 * offers stay off until the person turns them on. Booking, payment and security
 * messages are always sent and never consult these; `bookings` is kept only for
 * older clients that still send it.
 */
export const DEFAULT_NOTIFICATION_PREFS = {
  bookings: true,
  promotions: false,
  referrals: true,
};

export type NotificationPrefs = typeof DEFAULT_NOTIFICATION_PREFS;
export type OptionalNotificationKind = "promotions" | "referrals";

export function mergeNotificationPrefs(stored: unknown): NotificationPrefs {
  const value = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const pick = (key: keyof NotificationPrefs) => (typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_NOTIFICATION_PREFS[key]);
  return { bookings: pick("bookings"), promotions: pick("promotions"), referrals: pick("referrals") };
}

/**
 * Whether this person agreed to this kind of optional message. Use it only for
 * optional messages; never gate transactional or security messages on it.
 * When the preference cannot be read, the default applies (offers stay off).
 */
export async function wantsNotification(userId: number, kind: OptionalNotificationKind, db: any = prisma): Promise<boolean> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    return mergeNotificationPrefs(user?.notificationPrefs)[kind];
  } catch {
    return DEFAULT_NOTIFICATION_PREFS[kind];
  }
}
