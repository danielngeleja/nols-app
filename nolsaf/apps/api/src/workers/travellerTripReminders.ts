import { prisma } from "@nolsaf/prisma";
import type { Server as SocketServer } from "socket.io";

type Reminder = {
  userId: number;
  key: string;
  title: string;
  body: string;
  serviceKind: "STAY" | "TOUR" | "GROUP_STAY" | "RIDE";
  serviceId: number;
  screen: string;
  params?: Record<string, unknown>;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function deliver(io: SocketServer | undefined, item: Reminder) {
  const exists = await prisma.notification.findFirst({
    where: {
      userId: item.userId,
      meta: { path: "$.reminderKey", equals: item.key } as any,
    },
    select: { id: true },
  });
  if (exists) return false;

  const created = await prisma.notification.create({
    data: {
      userId: item.userId,
      title: item.title,
      body: item.body,
      type: "reminder",
      meta: {
        notificationKind: "traveller_trip_reminder",
        reminderKey: item.key,
        serviceKind: item.serviceKind,
        serviceId: item.serviceId,
        action: { screen: item.screen, params: item.params || {} },
      },
    },
  });
  io?.to(`user:${item.userId}`).emit("notification:new", {
    id: created.id,
    type: created.type,
    title: created.title,
    body: created.body,
    createdAt: created.createdAt,
  });
  return true;
}

function within(date: Date | null | undefined, now: Date, maximumMs: number) {
  if (!date) return false;
  const remaining = date.getTime() - now.getTime();
  return remaining > 0 && remaining <= maximumMs;
}

export async function runTravellerTripReminders(io?: SocketServer, now = new Date()) {
  const reminders: Reminder[] = [];
  const inSevenDays = new Date(now.getTime() + 7 * DAY);
  const tenHoursAgo = new Date(now.getTime() - 10 * HOUR);
  const twelveHoursAgo = new Date(now.getTime() - 12 * HOUR);

  const [stayPayments, tourPayments, deposits, groupCheckIns, stays, tours, rides] = await Promise.all([
    prisma.booking.findMany({
      where: { userId: { not: null }, status: "NEW", createdAt: { gte: twelveHoursAgo, lte: tenHoursAgo }, invoices: { some: { status: { notIn: ["PAID", "CUSTOMER_PAID", "PROCESSING"] } } } },
      include: { property: { select: { title: true } } },
    }),
    prisma.tourBooking.findMany({
      where: { customerId: { not: null }, status: "PENDING_PAYMENT", paymentStatus: { not: "PAID" }, createdAt: { gte: twelveHoursAgo, lte: tenHoursAgo } },
      select: { id: true, customerId: true, title: true },
    }),
    prisma.groupBooking.findMany({
      where: { status: "AWAITING_DEPOSIT", depositPaid: false, depositDueAt: { gt: now, lte: new Date(now.getTime() + 3 * HOUR) } },
      select: { id: true, userId: true, depositDueAt: true, toRegion: true },
    }),
    prisma.groupBooking.findMany({
      where: { status: { in: ["CONFIRMED", "PROCESSING"] }, checkIn: { gt: now, lte: new Date(now.getTime() + 48 * HOUR) } },
      include: { confirmedProperty: { select: { title: true } } },
    }),
    prisma.booking.findMany({
      where: { userId: { not: null }, status: "CONFIRMED", checkIn: { gt: now, lte: new Date(now.getTime() + 48 * HOUR) } },
      include: { property: { select: { title: true } }, code: { select: { code: true } } },
    }),
    prisma.tourBooking.findMany({
      where: { customerId: { not: null }, status: { in: ["PAID", "CONFIRMED"] }, startDate: { gt: now, lte: inSevenDays } },
      include: { travelers: { where: { status: "ACTIVE" }, select: { documentType: true, documentNumber: true, documentUrl: true, permitStatus: true } } },
    }),
    prisma.transportBooking.findMany({
      where: { status: { in: ["PENDING", "CONFIRMED", "ASSIGNED"] }, scheduledDate: { gt: now, lte: new Date(now.getTime() + 2 * HOUR) } },
      select: { id: true, userId: true, pickupTime: true, scheduledDate: true, fromAddress: true },
    }),
  ]);

  for (const booking of stayPayments) {
    if (!booking.userId) continue;
    reminders.push({ userId: booking.userId, key: `stay-payment:${booking.id}:2h`, title: "Payment window ending soon", body: `Complete payment for ${booking.property.title || "your stay"} before the booking session expires.`, serviceKind: "STAY", serviceId: booking.id, screen: "MyBookings" });
  }
  for (const booking of tourPayments) {
    if (!booking.customerId) continue;
    reminders.push({ userId: booking.customerId, key: `tour-payment:${booking.id}:2h`, title: "Tour payment window ending soon", body: `Complete payment for ${booking.title || "your tour"} before the booking session expires.`, serviceKind: "TOUR", serviceId: booking.id, screen: "TourDetail", params: { id: booking.id } });
  }
  for (const booking of deposits) {
    reminders.push({ userId: booking.userId, key: `group-deposit:${booking.id}:3h`, title: "Group stay deposit due soon", body: `Pay the deposit for your group stay${booking.toRegion ? ` in ${booking.toRegion}` : ""} before the offer expires.`, serviceKind: "GROUP_STAY", serviceId: booking.id, screen: "GroupStayDetail", params: { id: booking.id } });
  }
  for (const booking of groupCheckIns) {
    if (!booking.checkIn) continue;
    const title = booking.confirmedProperty?.title || `group stay #${booking.id}`;
    if (within(booking.checkIn, now, 24 * HOUR)) reminders.push({ userId: booking.userId, key: `group-checkin:${booking.id}:24h`, title: "Group stay check-in is coming up", body: `${title} check-in is within 24 hours. Review the roster and arrival arrangements.`, serviceKind: "GROUP_STAY", serviceId: booking.id, screen: "GroupStayDetail", params: { id: booking.id } });
    else reminders.push({ userId: booking.userId, key: `group-cancellation:${booking.id}:48h`, title: "Review your group stay terms", body: `${title} is approaching. Review the applicable cancellation terms before check-in.`, serviceKind: "GROUP_STAY", serviceId: booking.id, screen: "GroupStayDetail", params: { id: booking.id } });
  }
  for (const booking of stays) {
    if (!booking.userId) continue;
    const title = booking.property.title || "your stay";
    if (within(booking.checkIn, now, 24 * HOUR)) reminders.push({ userId: booking.userId, key: `stay-checkin:${booking.id}:24h`, title: "Check-in is coming up", body: `${title} check-in is within 24 hours. Review your booking and arrival details.`, serviceKind: "STAY", serviceId: booking.id, screen: "MyBookings" });
    else reminders.push({ userId: booking.userId, key: `stay-cancellation:${booking.id}:48h`, title: "Review your cancellation terms", body: `${title} is approaching. Review the applicable cancellation terms before check-in.`, serviceKind: "STAY", serviceId: booking.id, screen: "CancelBooking", params: { bookingCode: booking.code?.code || "", propertyTitle: title } });
  }
  for (const booking of tours) {
    if (!booking.customerId || !booking.startDate) continue;
    if (within(booking.startDate, now, 2 * HOUR)) reminders.push({ userId: booking.customerId, key: `tour-meeting:${booking.id}:2h`, title: "Tour meeting soon", body: `${booking.title} starts within 2 hours. Confirm your meeting point and contact the operator if needed.`, serviceKind: "TOUR", serviceId: booking.id, screen: "TourDetail", params: { id: booking.id } });
    else if (within(booking.startDate, now, 24 * HOUR)) reminders.push({ userId: booking.customerId, key: `tour-meeting:${booking.id}:24h`, title: "Tour meeting is coming up", body: `${booking.title} starts within 24 hours. Open the timeline to review the meeting details.`, serviceKind: "TOUR", serviceId: booking.id, screen: "TourDetail", params: { id: booking.id } });
    else if (within(booking.startDate, now, 48 * HOUR)) reminders.push({ userId: booking.customerId, key: `tour-cancellation:${booking.id}:48h`, title: "Review your tour cancellation terms", body: `${booking.title} is approaching. Review the applicable cancellation terms before departure.`, serviceKind: "TOUR", serviceId: booking.id, screen: "TourDetail", params: { id: booking.id } });
    const needsDocuments = booking.travelers.some((traveller) => {
      const permitRequired = !["", "NOT_REQUIRED", "APPROVED"].includes(String(traveller.permitStatus || "").toUpperCase());
      const partialIdentity = Boolean(traveller.documentType || traveller.documentNumber || traveller.documentUrl);
      return (permitRequired || partialIdentity) && !(traveller.documentType && traveller.documentNumber && traveller.documentUrl);
    });
    if (needsDocuments) reminders.push({ userId: booking.customerId, key: `tour-documents:${booking.id}:7d`, title: "Traveller documents need attention", body: `Complete the required traveller documents for ${booking.title} before departure.`, serviceKind: "TOUR", serviceId: booking.id, screen: "TourDetail", params: { id: booking.id } });
  }
  for (const ride of rides) {
    const pickup = ride.pickupTime || ride.scheduledDate;
    if (within(pickup, now, 30 * 60 * 1000)) reminders.push({ userId: ride.userId, key: `ride-pickup:${ride.id}:30m`, title: "Ride pickup soon", body: "Your pickup is within 30 minutes. Be ready and check your driver details.", serviceKind: "RIDE", serviceId: ride.id, screen: "RideDetail", params: { id: ride.id } });
    else if (within(pickup, now, 2 * HOUR)) reminders.push({ userId: ride.userId, key: `ride-pickup:${ride.id}:2h`, title: "Ride pickup is coming up", body: `Your ride pickup${ride.fromAddress ? ` from ${ride.fromAddress}` : ""} is within 2 hours.`, serviceKind: "RIDE", serviceId: ride.id, screen: "RideDetail", params: { id: ride.id } });
  }

  const userIds = [...new Set(reminders.map((item) => item.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, notificationPreferences: true } })
    : [];
  const enabledUsers = new Set(users.filter((user) => {
    const preferences = user.notificationPreferences && typeof user.notificationPreferences === "object" && !Array.isArray(user.notificationPreferences)
      ? user.notificationPreferences as Record<string, unknown>
      : {};
    return preferences.bookings !== false;
  }).map((user) => user.id));
  const eligible = reminders.filter((item) => enabledUsers.has(item.userId));
  let delivered = 0;
  for (const reminder of eligible) if (await deliver(io, reminder)) delivered += 1;
  return { candidates: reminders.length, eligible: eligible.length, delivered };
}

export function startTravellerTripReminders({ io, intervalMs = 10 * 60 * 1000 }: { io?: SocketServer; intervalMs?: number } = {}) {
  if ((global as any).__travellerTripRemindersStarted) return;
  (global as any).__travellerTripRemindersStarted = true;
  const run = () => runTravellerTripReminders(io).catch((error) => console.error("[travellerTripReminders]", error));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
}
