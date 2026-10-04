import { prisma } from "@nolsaf/prisma";

export const TRIP_SERVICE_KINDS = ["STAY", "TOUR", "GROUP_STAY", "RIDE"] as const;
export type TripServiceKind = (typeof TRIP_SERVICE_KINDS)[number];

export type SafeContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export type SafeTripSnapshot = {
  serviceKind: TripServiceKind;
  serviceId: number;
  title: string;
  destination: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: string;
  provider: SafeContact;
};

export const LOCAL_EMERGENCY_CONTACTS = [
  { country: "Tanzania", label: "Emergency / Police", phone: "112" },
  { country: "Tanzania", label: "Fire and rescue", phone: "114" },
  { country: "Tanzania", label: "Ambulance", phone: "115" },
  { country: "Tanzania", label: "Disaster services", phone: "190" },
] as const;

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(source: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function propertyContact(property: any): SafeContact {
  const settings = object(property?.nrmsGuestContactSettings);
  return {
    name: property?.title || null,
    phone: text(settings, ["phone", "contactPhone", "whatsapp", "whatsApp"]),
    email: text(settings, ["email", "contactEmail"]),
  };
}

function operatorContact(booking: any): SafeContact {
  const snapshot = object(booking?.operatorSnapshot);
  const profile = object(booking?.operator?.operatorProfile);
  return {
    name: text(snapshot, ["businessName", "name", "companyName", "operatorName"]) || text(profile, ["businessName", "name", "companyName", "operatorName"]),
    phone: text(snapshot, ["contactPhone", "phone", "whatsapp"]) || text(profile, ["contactPhone", "phone", "whatsapp"]),
    email: text(snapshot, ["contactEmail", "email"]) || text(profile, ["contactEmail", "email"]),
  };
}

function location(parts: unknown[]): string | null {
  const values = parts.map((part) => String(part || "").trim()).filter(Boolean);
  return values.length ? values.join(", ") : null;
}

export async function getSupportContact() {
  const settings = await prisma.systemSetting.findUnique({ where: { id: 1 } }).catch(() => null) as any;
  return {
    name: "NoLSAF support",
    email: settings?.supportEmail ?? process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@nolsaf.com",
    phone: settings?.supportPhone ?? process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "+255736766726",
  };
}

export async function loadTripSnapshot(kind: TripServiceKind, serviceId: number, userId?: number): Promise<SafeTripSnapshot | null> {
  if (kind === "STAY") {
    const row = await prisma.booking.findFirst({
      where: { id: serviceId, ...(userId ? { userId } : {}) },
      include: { property: { select: { title: true, regionName: true, district: true, city: true, nrmsGuestContactSettings: true } } },
    });
    if (!row) return null;
    return {
      serviceKind: kind,
      serviceId: row.id,
      title: row.property.title || "Verified stay",
      destination: location([row.property.regionName, row.property.district, row.property.city]),
      startAt: row.checkIn,
      endAt: row.checkOut,
      status: row.status,
      provider: propertyContact(row.property),
    };
  }

  if (kind === "TOUR") {
    const row = await prisma.tourBooking.findFirst({
      where: { id: serviceId, ...(userId ? { customerId: userId } : {}) },
      include: { operator: { select: { operatorProfile: true } } },
    });
    if (!row) return null;
    return {
      serviceKind: kind,
      serviceId: row.id,
      title: row.title || "Tour package",
      destination: row.destination,
      startAt: row.startDate,
      endAt: row.endDate,
      status: row.status,
      provider: operatorContact(row),
    };
  }

  if (kind === "GROUP_STAY") {
    const row = await prisma.groupBooking.findFirst({
      where: { id: serviceId, ...(userId ? { userId } : {}) },
      include: { confirmedProperty: { select: { title: true, regionName: true, district: true, city: true, nrmsGuestContactSettings: true } } },
    });
    if (!row) return null;
    return {
      serviceKind: kind,
      serviceId: row.id,
      title: row.confirmedProperty?.title || "Group stay",
      destination: location([row.toRegion, row.toDistrict, row.toLocation]),
      startAt: row.checkIn,
      endAt: row.checkOut,
      status: row.status,
      provider: propertyContact(row.confirmedProperty),
    };
  }

  const row = await prisma.transportBooking.findFirst({
    where: { id: serviceId, ...(userId ? { userId } : {}) },
    include: { driver: { select: { name: true, phone: true, email: true } }, property: { select: { title: true } } },
  });
  if (!row) return null;
  return {
    serviceKind: kind,
    serviceId: row.id,
    title: row.property?.title ? `Ride to ${row.property.title}` : "NoLSAF ride",
    destination: location([row.toRegion, row.toDistrict, row.toAddress]),
    startAt: row.pickupTime || row.scheduledDate,
    endAt: row.dropoffTime,
    status: row.status,
    provider: {
      name: row.driver?.name || "Assigned driver",
      phone: row.driver?.phone || null,
      email: row.driver?.email || null,
    },
  };
}

export function isShareableTrip(snapshot: SafeTripSnapshot, now = new Date()): boolean {
  const terminal = new Set(["CANCELED", "CANCELLED", "COMPLETED", "CHECKED_OUT", "EXPIRED", "REFUNDED"]);
  if (terminal.has(String(snapshot.status || "").toUpperCase())) return false;
  if (snapshot.endAt && snapshot.endAt.getTime() < now.getTime() - 24 * 60 * 60 * 1000) return false;
  return true;
}

export function tripShareExpiry(snapshot: SafeTripSnapshot, now = new Date()): Date {
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (!snapshot.endAt) return sevenDays;
  const afterTrip = new Date(snapshot.endAt.getTime() + 24 * 60 * 60 * 1000);
  return afterTrip.getTime() < sevenDays.getTime() ? afterTrip : sevenDays;
}
