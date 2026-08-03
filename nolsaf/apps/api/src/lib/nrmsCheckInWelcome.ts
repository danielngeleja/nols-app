export const NRMS_CHECK_IN_WELCOME_TEMPLATE_NAME = "NoLSAF automatic room-ordering welcome";

type DbLike = any;

export type CheckInWelcomeQueueResult =
  | { status: "QUEUED"; deliveryId: number; orderPointId: number }
  | { status: "SKIPPED"; reason: "NOT_CHECKED_IN" | "NRMS_INACTIVE" | "NO_GUEST_PHONE" | "QR_ORDERING_FROZEN" | "NO_ASSIGNED_ROOM" | "NO_ACTIVE_ROOM_QR" | "NO_ACTIVE_OUTLET" };

function webOrigin(): string {
  return String(process.env.WEB_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/$/, "");
}

function welcomeMessage(guestName: string, propertyName: string, outletTypes: Set<string>, orderingUrl: string): string {
  const offer = outletTypes.has("RESTAURANT") && outletTypes.has("BAR")
    ? "food and drinks"
    : outletTypes.has("RESTAURANT")
      ? "food"
      : "drinks";
  return `Welcome ${guestName} to ${propertyName}! Don't worry about ${offer}. We have them here. Tap to order from your room: ${orderingUrl}\nQuality Stay for Every Wallet`;
}

/**
 * Creates the transactional SMS outbox entry for the built-in check-in
 * welcome. Delivery is performed by the guest-automation worker, never in the
 * check-in request, so an SMS provider outage cannot undo a valid check-in.
 *
 * The unique (template, reservation) delivery key makes this safe to call
 * from retries and every check-in surface.
 */
export async function queueNrmsCheckInWelcome(db: DbLike, reservationId: number): Promise<CheckInWelcomeQueueResult> {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      propertyId: true,
      guestProfileId: true,
      status: true,
      property: { select: { title: true, nrmsActivatedAt: true, nrmsQrOrderingFrozenAt: true } },
      guestProfile: { select: { fullName: true, phone: true } },
      allocations: {
        where: { status: "ACTIVE", roomUnitId: { not: null } },
        select: { roomUnitId: true },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!reservation || reservation.status !== "CHECKED_IN") return { status: "SKIPPED", reason: "NOT_CHECKED_IN" };
  if (!reservation.property.nrmsActivatedAt) return { status: "SKIPPED", reason: "NRMS_INACTIVE" };
  if (!reservation.guestProfile?.phone) return { status: "SKIPPED", reason: "NO_GUEST_PHONE" };
  if (reservation.property.nrmsQrOrderingFrozenAt) return { status: "SKIPPED", reason: "QR_ORDERING_FROZEN" };

  const roomUnitIds = reservation.allocations
    .map((allocation: { roomUnitId: number | null }) => allocation.roomUnitId)
    .filter((id: number | null): id is number => id != null);
  if (!roomUnitIds.length) return { status: "SKIPPED", reason: "NO_ASSIGNED_ROOM" };

  const [point, outlets] = await Promise.all([
    db.nrmsOrderPoint.findFirst({
      where: {
        propertyId: reservation.propertyId,
        type: "ROOM",
        roomUnitId: { in: roomUnitIds },
        active: true,
        orderingEnabled: true,
      },
      select: { id: true, token: true },
      orderBy: { id: "asc" },
    }),
    db.nrmsOutlet.findMany({
      where: { propertyId: reservation.propertyId, type: { in: ["RESTAURANT", "BAR"] }, status: "ACTIVE" },
      select: { type: true },
    }),
  ]);

  if (!point) return { status: "SKIPPED", reason: "NO_ACTIVE_ROOM_QR" };
  if (!outlets.length) return { status: "SKIPPED", reason: "NO_ACTIVE_OUTLET" };

  const template = await db.nrmsJourneyTemplate.upsert({
    where: { propertyId_name: { propertyId: reservation.propertyId, name: NRMS_CHECK_IN_WELCOME_TEMPLATE_NAME } },
    create: {
      propertyId: reservation.propertyId,
      name: NRMS_CHECK_IN_WELCOME_TEMPLATE_NAME,
      trigger: "CHECK_IN",
      offsetMinutes: 0,
      channel: "SMS",
      message: "Welcome {{guest}} to {{property}}! Tap the secure room-ordering link in this message to order from the hotel's restaurant or bar.",
      active: true,
    },
    update: { trigger: "CHECK_IN", offsetMinutes: 0, channel: "SMS", active: true },
    select: { id: true },
  });

  const orderingUrl = `${webOrigin()}/menu/${point.token}`;
  const renderedMessage = welcomeMessage(
    reservation.guestProfile.fullName || "Guest",
    reservation.property.title,
    new Set(outlets.map((outlet: { type: string }) => outlet.type)),
    orderingUrl,
  );
  const delivery = await db.nrmsJourneyDelivery.upsert({
    where: { templateId_reservationId: { templateId: template.id, reservationId: reservation.id } },
    create: {
      templateId: template.id,
      reservationId: reservation.id,
      guestProfileId: reservation.guestProfileId,
      scheduledAt: new Date(),
      renderedMessage,
    },
    update: {},
    select: { id: true },
  });
  return { status: "QUEUED", deliveryId: delivery.id, orderPointId: point.id };
}
