import { prisma } from '@nolsaf/prisma';
import {
  effectiveRoomSelectionCode,
  matchingRoomSelectionCodes,
  roomTypeNameFor,
  roomsSpecEntries,
} from '../lib/roomSelectionCode.js';

/**
 * Room inventory and sales across approved properties, for the admin
 * dashboard.
 *
 * Inventory is what owners declared in Property.roomsSpec: each option carries
 * a room type picked from the owner form's fixed list ("Double", "Suite", ...)
 * and a roomsCount, so types compare across properties. Sales are occupied
 * room-nights inside the window (roomsQty x nights that fall in the window) on
 * bookings that hold a room, so sell-through reads as occupancy for the period.
 *
 * A booking is attributed through its stored roomCode, the same way
 * availability does. A booking that cannot be tied to one room type (older
 * rows with no code on a property with several types) is kept in an
 * "Unassigned" row so the totals still reconcile with bookings.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bookings that hold a room: paid, arriving, in house or completed. */
export const OCCUPYING_STATUSES = ['CONFIRMED', 'PENDING_CHECKIN', 'CHECKED_IN', 'CHECKED_OUT'];

export const UNASSIGNED_TYPE = 'Unassigned';

export type InventoryProperty = { id: number; roomsSpec: unknown };
export type InventoryBooking = { propertyId: number; roomCode: string | null; roomsQty: number; checkIn: Date; checkOut: Date };

export type RoomTypeRow = {
  type: string;
  roomsDeclared: number;
  properties: number;
  bookings: number;
  roomNights: number;
  /** Occupied share of the type's available room-nights, 0 to 100; null when nothing is declared. */
  sellThrough: number | null;
};

export type RoomInventoryReport = {
  from: string;
  to: string;
  nights: number;
  totals: {
    roomTypes: number;
    roomsDeclared: number;
    propertiesWithRooms: number;
    bookings: number;
    roomNights: number;
    sellThrough: number | null;
  };
  topSeller: string | null;
  rows: RoomTypeRow[];
};

function roomsCountOf(entry: unknown): number {
  const source = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
  const n = Math.floor(Number(source.roomsCount ?? source.count ?? 1));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** "double room" and "Double" read as one type across properties. */
function displayType(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Room';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Whole nights of the stay that begin inside [from, to). Night k starts at
 * checkIn + k days, so a stay never contributes a fraction of a night when
 * the window edge falls mid-day.
 */
function nightsInWindow(checkIn: Date, checkOut: Date, from: Date, to: Date): number {
  const stayNights = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  if (stayNights <= 0) return 0;
  const first = Math.max(0, Math.ceil((from.getTime() - checkIn.getTime()) / DAY_MS));
  const end = Math.min(stayNights, Math.ceil((to.getTime() - checkIn.getTime()) / DAY_MS));
  return Math.max(0, end - first);
}

export function summarizeRoomInventory(
  properties: InventoryProperty[],
  bookings: InventoryBooking[],
  from: Date,
  to: Date,
): RoomInventoryReport {
  const nights = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const rows = new Map<string, RoomTypeRow & { propertyIds: Set<number> }>();
  const rowFor = (type: string) => {
    const key = type.toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = { type, roomsDeclared: 0, properties: 0, bookings: 0, roomNights: 0, sellThrough: null, propertyIds: new Set() };
      rows.set(key, row);
    }
    return row;
  };

  // Per property: code -> type, so a booking resolves the way availability does.
  const specByProperty = new Map<number, { spec: unknown; codes: string[]; typeByCode: Map<string, string> }>();
  for (const property of properties) {
    const entries = roomsSpecEntries(property.roomsSpec);
    if (!entries.length) continue;
    const typeByCode = new Map<string, string>();
    for (const entry of entries) {
      const type = displayType(roomTypeNameFor(entry));
      typeByCode.set(effectiveRoomSelectionCode(entry), type);
      const row = rowFor(type);
      row.roomsDeclared += roomsCountOf(entry);
      row.propertyIds.add(property.id);
    }
    specByProperty.set(property.id, { spec: property.roomsSpec, codes: [...typeByCode.keys()], typeByCode });
  }

  for (const booking of bookings) {
    const roomNights = Math.max(1, Number(booking.roomsQty) || 1) * nightsInWindow(booking.checkIn, booking.checkOut, from, to);
    if (roomNights <= 0) continue;
    const spec = specByProperty.get(booking.propertyId);
    let type = UNASSIGNED_TYPE;
    if (spec) {
      const matched = booking.roomCode
        ? new Set(matchingRoomSelectionCodes(booking.roomCode, spec.codes, spec.spec).map((code) => spec.typeByCode.get(code)))
        : new Set<string | undefined>();
      const propertyTypes = new Set(spec.typeByCode.values());
      // A legacy bare type ("Single") can match several variants of that one
      // type, which is still one type. A property with a single type owns
      // every booking on it, coded or not.
      if (matched.size === 1 && [...matched][0]) type = [...matched][0] as string;
      else if (propertyTypes.size === 1) type = [...propertyTypes][0];
    }
    const row = rowFor(type);
    row.bookings += 1;
    row.roomNights += roomNights;
  }

  const list: RoomTypeRow[] = [...rows.values()].map(({ propertyIds, ...row }) => ({
    ...row,
    properties: propertyIds.size,
    sellThrough: row.roomsDeclared > 0 ? Math.round((row.roomNights / (row.roomsDeclared * nights)) * 1000) / 10 : null,
  }));
  list.sort((a, b) => {
    if (a.type === UNASSIGNED_TYPE) return 1;
    if (b.type === UNASSIGNED_TYPE) return -1;
    return b.roomNights - a.roomNights || b.roomsDeclared - a.roomsDeclared || a.type.localeCompare(b.type);
  });

  const declaredRows = list.filter((r) => r.type !== UNASSIGNED_TYPE);
  const roomsDeclared = declaredRows.reduce((s, r) => s + r.roomsDeclared, 0);
  const roomNights = list.reduce((s, r) => s + r.roomNights, 0);
  const top = declaredRows[0];

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    nights,
    totals: {
      roomTypes: declaredRows.filter((r) => r.roomsDeclared > 0).length,
      roomsDeclared,
      propertiesWithRooms: specByProperty.size,
      bookings: list.reduce((s, r) => s + r.bookings, 0),
      roomNights,
      sellThrough: roomsDeclared > 0 ? Math.round((roomNights / (roomsDeclared * nights)) * 1000) / 10 : null,
    },
    topSeller: top && top.roomNights > 0 ? top.type : null,
    rows: list,
  };
}

export async function getRoomInventory(from?: string, to?: string, region?: string): Promise<RoomInventoryReport> {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(toDate.getTime() - 30 * DAY_MS);
  if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime()) || fromDate >= toDate) {
    throw Object.assign(new Error('Invalid date range'), { status: 400 });
  }
  const propertyWhere = { status: 'APPROVED', ...(region && region !== 'ALL' ? { regionId: String(region) } : {}) };

  const [properties, bookings] = await Promise.all([
    prisma.property.findMany({ where: propertyWhere as any, select: { id: true, roomsSpec: true } }),
    prisma.booking.findMany({
      where: {
        status: { in: OCCUPYING_STATUSES },
        checkIn: { lt: toDate },
        checkOut: { gt: fromDate },
        property: propertyWhere as any,
      },
      select: { propertyId: true, roomCode: true, roomsQty: true, checkIn: true, checkOut: true },
    }),
  ]);

  return summarizeRoomInventory(properties, bookings, fromDate, toDate);
}
