// apps/api/src/lib/nrmsAvailability.ts
// Shared availability kernel (doc 6.1): one calculation fed by the three
// inventory consumers - marketplace bookings, NRMS reservations, and
// availability blocks. Every calendar or booking flow must read from here so
// the marketplace and NRMS can never disagree about what is sellable.
import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES, REAL_BOOKING_STATUSES } from "./bookingStatus.js";

type DbLike = typeof prisma | any;

/** Reservation statuses that consume inventory (doc 6.4). HELD only until expiry. */
export const INVENTORY_CONSUMING_RESERVATION_STATUSES = ["HELD", "CONFIRMED", "CHECKED_IN"] as const;

export type CalendarEntry = {
  kind: "BOOKING" | "RESERVATION" | "BLOCK";
  id: number;
  startDate: Date;
  endDate: Date;
  status: string;
  source: string | null;
  roomTypeId: number | null;
  roomUnitId: number | null;
  /// Legacy free-text room reference (Booking.roomCode / block.roomCode)
  roomCode: string | null;
  /// How many rooms this entry consumes when it has no unit-level allocation
  quantity: number;
  guestName: string | null;
  label: string;
  billable: boolean;
};

function overlapWhere(start: Date, end: Date, startField: string, endField: string) {
  return { AND: [{ [endField]: { gt: start } }, { [startField]: { lt: end } }] };
}

/**
 * Serialize every inventory mutation for one property. Public NoLSAF booking
 * creation already takes this same row lock, so NRMS and marketplace writes
 * cannot both pass availability checks concurrently.
 */
export async function lockPropertyInventory(tx: any, propertyId: number): Promise<void> {
  await tx.$executeRawUnsafe("SELECT id FROM `property` WHERE id = ? FOR UPDATE", propertyId);
}

export type NrmsCapacityConsumer = {
  reservationId: number;
  allocationId: number;
  roomTypeId: number;
  roomTypeName: string;
  roomUnitId: number | null;
  roomUnitCode: string | null;
  startDate: Date;
  endDate: Date;
};

/** External NRMS allocations that must reduce NoLSAF marketplace capacity. */
export async function getNrmsCapacityConsumers(
  db: DbLike,
  propertyId: number,
  start: Date,
  end: Date,
  opts?: { excludeReservationId?: number; excludeGroupBlockId?: number; excludeBlockId?: number },
): Promise<NrmsCapacityConsumer[]> {
  const rows = await db.reservationRoomAllocation.findMany({
    where: {
      status: "ACTIVE",
      ...overlapWhere(start, end, "startDate", "endDate"),
      reservation: {
        propertyId,
        bookingId: null,
        ...(opts?.excludeReservationId ? { id: { not: opts.excludeReservationId } } : {}),
        OR: [
          { status: { in: ["CONFIRMED", "CHECKED_IN"] } },
          { status: "HELD", holdExpiresAt: { gt: new Date() } },
        ],
      },
    },
    select: {
      id: true,
      reservationId: true,
      roomTypeId: true,
      roomUnitId: true,
      startDate: true,
      endDate: true,
      roomType: { select: { name: true } },
      roomUnit: { select: { code: true } },
    },
  });
  return rows.map((row: any) => ({
    reservationId: row.reservationId,
    allocationId: row.id,
    roomTypeId: row.roomTypeId,
    roomTypeName: row.roomType.name,
    roomUnitId: row.roomUnitId,
    roomUnitCode: row.roomUnit?.code ?? null,
    startDate: row.startDate,
    endDate: row.endDate,
  }));
}

export async function getRoomTypeAvailability(
  db: DbLike,
  propertyId: number,
  roomTypeId: number,
  start: Date,
  end: Date,
  opts?: { excludeReservationId?: number; excludeGroupBlockId?: number; excludeBlockId?: number },
): Promise<{ capacity: number; consumed: number; available: number }> {
  const result = await getRoomTypesAvailability(
    db,
    propertyId,
    [roomTypeId],
    start,
    end,
    opts,
  );
  return result.get(roomTypeId) ?? { capacity: 0, consumed: 0, available: 0 };
}

/**
 * Batch availability for public quote and calendar consumers. The previous
 * per-room-type path repeated the same booking, block, and reservation scans
 * four times for every room type.
 */
export async function getRoomTypesAvailability(
  db: DbLike,
  propertyId: number,
  roomTypeIds: number[],
  start: Date,
  end: Date,
  opts?: { excludeReservationId?: number; excludeGroupBlockId?: number; excludeBlockId?: number },
): Promise<Map<number, { capacity: number; consumed: number; available: number }>> {
  const uniqueIds = [...new Set(roomTypeIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) return new Map();

  const [roomTypes, consumers, bookings, blocks, groupBlocks] = await Promise.all([
    db.roomType.findMany({
      where: { id: { in: uniqueIds }, propertyId },
      select: { id: true, name: true, _count: { select: { units: { where: { status: "ACTIVE" } } } } },
    }),
    getNrmsCapacityConsumers(db, propertyId, start, end, opts),
    db.booking.findMany({
      where: {
        propertyId,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        ...overlapWhere(start, end, "checkIn", "checkOut"),
      },
      select: { roomCode: true, roomsQty: true },
    }),
    db.propertyAvailabilityBlock.findMany({
      where: {
        propertyId,
        migratedReservationId: null,
        ...(opts?.excludeBlockId ? { id: { not: opts.excludeBlockId } } : {}),
        ...overlapWhere(start, end, "startDate", "endDate"),
      },
      select: { roomCode: true, roomUnitId: true, bedsBlocked: true, roomUnit: { select: { roomTypeId: true } } },
    }),
    // Group blocks hold rooms before any guest name exists. Only the rooms not
    // yet picked up count here: a picked-up room is already consumed by the
    // reservation it became, and counting both would double-block it. Past
    // cutOffAt the block stops holding anything, the same lazy expiry a HELD
    // reservation gets from holdExpiresAt, so no worker has to run.
    db.nrmsGroupBlock.findMany({
      where: {
        propertyId,
        ...(opts?.excludeGroupBlockId ? { id: { not: opts.excludeGroupBlockId } } : {}),
        status: { in: ["HELD", "PARTIALLY_PICKED_UP"] },
        cutOffAt: { gt: new Date() },
        ...overlapWhere(start, end, "checkIn", "checkOut"),
      },
      select: { rooms: { select: { roomTypeId: true, quantity: true, pickedUp: true } } },
    }),
  ]);

  const result = new Map<number, { capacity: number; consumed: number; available: number }>();
  for (const roomType of roomTypes) {
    const matchesType = (code: string | null | undefined) => {
      const value = String(code ?? "").trim().toLowerCase();
      const name = roomType.name.trim().toLowerCase();
      return value === name || value.startsWith(`${name}-`) || value.startsWith(`${name} `);
    };
    const nrmsCount = consumers.filter((row) => row.roomTypeId === roomType.id).length;
    const bookingCount = bookings
      .filter((row: any) => matchesType(row.roomCode))
      .reduce((sum: number, row: any) => sum + Math.max(1, Number(row.roomsQty ?? 1)), 0);
    const blockCount = blocks
      .filter((row: any) => row.roomUnit?.roomTypeId === roomType.id || matchesType(row.roomCode))
      .reduce((sum: number, row: any) => sum + Math.max(1, Number(row.bedsBlocked ?? 1)), 0);
    const groupBlockCount = groupBlocks.reduce((sum: number, block: any) => sum + block.rooms
      .filter((room: any) => room.roomTypeId === roomType.id)
      .reduce((held: number, room: any) => held + Math.max(0, Number(room.quantity ?? 0) - Number(room.pickedUp ?? 0)), 0), 0);
    const capacity = roomType._count.units;
    const consumed = nrmsCount + bookingCount + blockCount + groupBlockCount;
    result.set(roomType.id, {
      capacity,
      consumed,
      available: Math.max(0, capacity - consumed),
    });
  }
  return result;
}

export type DailyAvailability = { day: Date; capacity: number; consumed: number; available: number };

/**
 * Availability for one room type, night by night.
 *
 * getRoomTypesAvailability answers "can this range be sold as a whole", which
 * collapses a twelve-month window into a single sold-out verdict the moment one
 * night is taken. A calendar export needs the opposite: which individual nights
 * are gone. Same four inventory consumers, kept dated instead of counted.
 */
export async function getRoomTypeDailyAvailability(
  db: DbLike,
  propertyId: number,
  roomTypeId: number,
  start: Date,
  end: Date,
): Promise<DailyAvailability[]> {
  const dayMs = 86_400_000;
  const utcDay = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const from = utcDay(start);
  const to = utcDay(end);
  if (to.getTime() <= from.getTime()) return [];

  const [roomType, consumers, bookings, blocks, groupBlocks] = await Promise.all([
    db.roomType.findUnique({
      where: { id: roomTypeId },
      select: { id: true, name: true, propertyId: true, _count: { select: { units: { where: { status: "ACTIVE" } } } } },
    }),
    getNrmsCapacityConsumers(db, propertyId, from, to),
    db.booking.findMany({
      where: {
        propertyId,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        ...overlapWhere(from, to, "checkIn", "checkOut"),
      },
      select: { roomCode: true, roomsQty: true, checkIn: true, checkOut: true },
    }),
    db.propertyAvailabilityBlock.findMany({
      where: {
        propertyId,
        migratedReservationId: null,
        ...overlapWhere(from, to, "startDate", "endDate"),
      },
      select: { roomCode: true, bedsBlocked: true, startDate: true, endDate: true, roomUnit: { select: { roomTypeId: true } } },
    }),
    db.nrmsGroupBlock.findMany({
      where: {
        propertyId,
        status: { in: ["HELD", "PARTIALLY_PICKED_UP"] },
        cutOffAt: { gt: new Date() },
        ...overlapWhere(from, to, "checkIn", "checkOut"),
      },
      select: { checkIn: true, checkOut: true, rooms: { select: { roomTypeId: true, quantity: true, pickedUp: true } } },
    }),
  ]);
  if (!roomType || roomType.propertyId !== propertyId) return [];

  const name = roomType.name.trim().toLowerCase();
  const matchesType = (code: string | null | undefined) => {
    const value = String(code ?? "").trim().toLowerCase();
    return value === name || value.startsWith(`${name}-`) || value.startsWith(`${name} `);
  };

  // One pass over each consumer, adding its weight to every night it covers,
  // rather than one query per night.
  const nights = Math.round((to.getTime() - from.getTime()) / dayMs);
  const consumedPerDay = new Array<number>(nights).fill(0);
  const addSpan = (spanStart: Date, spanEnd: Date, weight: number) => {
    if (weight <= 0) return;
    const first = Math.max(0, Math.floor((utcDay(spanStart).getTime() - from.getTime()) / dayMs));
    const last = Math.min(nights, Math.ceil((utcDay(spanEnd).getTime() - from.getTime()) / dayMs));
    for (let index = first; index < last; index += 1) consumedPerDay[index] += weight;
  };

  for (const consumer of consumers) {
    if (consumer.roomTypeId === roomTypeId) addSpan(consumer.startDate, consumer.endDate, 1);
  }
  for (const booking of bookings as any[]) {
    if (matchesType(booking.roomCode)) addSpan(booking.checkIn, booking.checkOut, Math.max(1, Number(booking.roomsQty ?? 1)));
  }
  for (const block of blocks as any[]) {
    if (block.roomUnit?.roomTypeId === roomTypeId || matchesType(block.roomCode)) {
      addSpan(block.startDate, block.endDate, Math.max(1, Number(block.bedsBlocked ?? 1)));
    }
  }
  for (const group of groupBlocks as any[]) {
    const held = group.rooms
      .filter((room: any) => room.roomTypeId === roomTypeId)
      .reduce((sum: number, room: any) => sum + Math.max(0, Number(room.quantity ?? 0) - Number(room.pickedUp ?? 0)), 0);
    addSpan(group.checkIn, group.checkOut, held);
  }

  const capacity = roomType._count.units;
  return consumedPerDay.map((consumed, index) => ({
    day: new Date(from.getTime() + index * dayMs),
    capacity,
    consumed,
    available: Math.max(0, capacity - consumed),
  }));
}

/**
 * Normalized calendar feed (doc 10.3). The frontend must not need to know
 * which migration stage a property has reached: legacy blocks, migrated
 * reservations, and marketplace bookings come back in one shape.
 */
export async function getCalendarEntries(propertyId: number, start: Date, end: Date): Promise<CalendarEntry[]> {
  const [bookings, reservations, blocks, roomTypes] = await Promise.all([
    prisma.booking.findMany({
      where: {
        propertyId,
        status: { in: [...REAL_BOOKING_STATUSES] },
        ...overlapWhere(start, end, "checkIn", "checkOut"),
      },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        roomsQty: true,
        roomCode: true,
        guestName: true,
        nrmsReservation: {
          select: {
            id: true,
            status: true,
            allocations: {
              where: { status: "ACTIVE" },
              select: { roomTypeId: true, roomUnitId: true, startDate: true, endDate: true },
            },
          },
        },
      },
    }),
    prisma.reservation.findMany({
      where: {
        propertyId,
        bookingId: null, // marketplace stays surface through their Booking row
        OR: [
          { status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] } },
          { status: "HELD", holdExpiresAt: { gt: new Date() } },
        ],
        ...overlapWhere(start, end, "checkIn", "checkOut"),
      },
      select: {
        id: true,
        status: true,
        source: true,
        checkIn: true,
        checkOut: true,
        guestProfile: { select: { fullName: true } },
        allocations: {
          where: { status: "ACTIVE" },
          select: { roomTypeId: true, roomUnitId: true, startDate: true, endDate: true },
        },
      },
    }),
    prisma.propertyAvailabilityBlock.findMany({
      where: {
        propertyId,
        migratedReservationId: null, // migrated blocks live on as reservations
        ...overlapWhere(start, end, "startDate", "endDate"),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        source: true,
        kind: true,
        roomCode: true,
        roomUnitId: true,
        guestName: true,
        bedsBlocked: true,
        notes: true,
      },
    }),
    prisma.roomType.findMany({
      where: { propertyId },
      select: {
        id: true,
        name: true,
        sourceSpecKey: true,
        units: { select: { id: true, code: true } },
      },
    }),
  ]);

  const entries: CalendarEntry[] = [];

  const resolveLegacyBookingRoom = (roomCode: string | null) => {
    const value = String(roomCode ?? "").trim();
    if (!value) return { roomTypeId: null, roomUnitId: null };
    for (const type of roomTypes) {
      const unit = type.units.find((candidate) => candidate.code.toLowerCase() === value.toLowerCase());
      if (unit) return { roomTypeId: type.id, roomUnitId: unit.id };
    }
    const key = value.replace(/-\d+$/, "").toLowerCase();
    const type = roomTypes
      .filter((candidate) =>
        [candidate.name, candidate.sourceSpecKey].some((raw) => {
          const name = String(raw ?? "").trim().toLowerCase();
          return name !== "" && (name === key || key.startsWith(`${name} `));
        }),
      )
      .sort((a, b) => b.name.length - a.name.length)[0];
    return { roomTypeId: type?.id ?? null, roomUnitId: null };
  };

  for (const b of bookings) {
    const allocation = b.nrmsReservation?.allocations?.[0] ?? null;
    const legacyRoom = allocation ? null : resolveLegacyBookingRoom(b.roomCode ?? null);
    entries.push({
      kind: "BOOKING",
      id: b.id,
      startDate: b.checkIn,
      endDate: b.checkOut,
      status: b.status,
      source: "NOLSAF",
      roomTypeId: allocation?.roomTypeId ?? legacyRoom?.roomTypeId ?? null,
      roomUnitId: allocation?.roomUnitId ?? legacyRoom?.roomUnitId ?? null,
      roomCode: b.roomCode ?? null,
      quantity: b.roomsQty ?? 1,
      guestName: b.guestName ?? null,
      label: b.guestName ? `${b.guestName} · NoLSAF` : "NoLSAF booking",
      billable: false, // commission-only; never an NRMS room-night fee (doc 8.2)
    });
  }

  for (const r of reservations) {
    if (r.allocations.length === 0) {
      entries.push({
        kind: "RESERVATION",
        id: r.id,
        startDate: r.checkIn,
        endDate: r.checkOut,
        status: r.status,
        source: r.source,
        roomTypeId: null,
        roomUnitId: null,
        roomCode: null,
        quantity: 1,
        guestName: r.guestProfile?.fullName ?? null,
        label: r.guestProfile?.fullName ?? "External reservation",
        billable: true,
      });
    } else {
      for (const a of r.allocations) {
        entries.push({
          kind: "RESERVATION",
          id: r.id,
          startDate: a.startDate,
          endDate: a.endDate,
          status: r.status,
          source: r.source,
          roomTypeId: a.roomTypeId,
          roomUnitId: a.roomUnitId,
          roomCode: null,
          quantity: 1,
          guestName: r.guestProfile?.fullName ?? null,
          label: r.guestProfile?.fullName ?? "External reservation",
          billable: true,
        });
      }
    }
  }

  for (const blk of blocks) {
    const isOperational = blk.kind === "OPERATIONAL" || (!blk.kind && !blk.guestName);
    entries.push({
      kind: "BLOCK",
      id: blk.id,
      startDate: blk.startDate,
      endDate: blk.endDate,
      status: blk.kind ?? (blk.guestName ? "EXTERNAL_LEGACY" : "OPERATIONAL"),
      source: blk.source ?? null,
      roomTypeId: null,
      roomUnitId: blk.roomUnitId ?? null,
      roomCode: blk.roomCode ?? null,
      quantity: blk.bedsBlocked ?? 1,
      guestName: blk.guestName ?? null,
      label: isOperational ? (blk.notes ? blk.notes.slice(0, 80) : "Blocked") : (blk.guestName ?? "External booking"),
      billable: false, // blocks are never billable (doc 4, 8.2)
    });
  }

  // Group blocks: rooms held for a party whose names are not in yet. These
  // consume capacity in getRoomTypesAvailability, so without an entry here the
  // calendar would show rooms free while the desk was refused a walk-in, with
  // nothing on screen explaining why. One entry per room type still held.
  const groupBlocks = await prisma.nrmsGroupBlock.findMany({
    where: {
      propertyId,
      status: { in: ["HELD", "PARTIALLY_PICKED_UP"] },
      cutOffAt: { gt: new Date() },
      ...overlapWhere(start, end, "checkIn", "checkOut"),
    },
    select: {
      id: true,
      name: true,
      reference: true,
      agencyName: true,
      checkIn: true,
      checkOut: true,
      rooms: { select: { roomTypeId: true, quantity: true, pickedUp: true } },
    },
  });
  for (const groupBlock of groupBlocks) {
    for (const room of groupBlock.rooms) {
      const held = Math.max(0, room.quantity - room.pickedUp);
      if (held < 1) continue;
      entries.push({
        kind: "BLOCK",
        id: groupBlock.id,
        startDate: groupBlock.checkIn,
        endDate: groupBlock.checkOut,
        status: "GROUP_BLOCK",
        source: groupBlock.agencyName ?? null,
        roomTypeId: room.roomTypeId,
        roomUnitId: null,
        roomCode: null,
        quantity: held,
        guestName: null,
        // Names are exactly what a block does not have yet, so the label says
        // whose rooms these are and how many are still waiting on a name.
        label: `${groupBlock.name} · ${held} awaiting names`,
        billable: false,
      });
    }
  }

  return entries.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

export type UnitConflict = {
  roomUnitId: number;
  entryKind: CalendarEntry["kind"];
  entryId: number;
  startDate: Date;
  endDate: Date;
};

/**
 * Room-unit conflict check for a proposed date range (doc 7.2: clear warnings
 * before overbooking; doc 14: protect availability writes). Callers wrap this
 * plus the allocation insert in one transaction for concurrency safety.
 */
export async function findUnitConflicts(
  roomUnitId: number,
  start: Date,
  end: Date,
  opts?: { excludeReservationId?: number; excludeBookingId?: number; db?: DbLike },
): Promise<UnitConflict[]> {
  const db = opts?.db ?? prisma;
  const unit = await db.roomUnit.findUnique({ where: { id: roomUnitId }, select: { propertyId: true, code: true } });
  if (!unit) return [];
  const [allocations, blocks, bookings] = await Promise.all([
    db.reservationRoomAllocation.findMany({
      where: {
        roomUnitId,
        status: "ACTIVE",
        ...overlapWhere(start, end, "startDate", "endDate"),
        reservation: {
          ...(opts?.excludeReservationId ? { id: { not: opts.excludeReservationId } } : {}),
          OR: [
            { status: { in: ["CONFIRMED", "CHECKED_IN"] } },
            { status: "HELD", holdExpiresAt: { gt: new Date() } },
          ],
        },
      },
      select: { reservationId: true, startDate: true, endDate: true },
    }),
    db.propertyAvailabilityBlock.findMany({
      where: {
        roomUnitId,
        migratedReservationId: null,
        ...overlapWhere(start, end, "startDate", "endDate"),
      },
      select: { id: true, startDate: true, endDate: true },
    }),
    db.booking.findMany({
      where: {
        ...(opts?.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
        propertyId: unit.propertyId,
        roomCode: unit.code,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        ...overlapWhere(start, end, "checkIn", "checkOut"),
      },
      select: { id: true, checkIn: true, checkOut: true },
    }),
  ]);

  return [
    ...allocations.map((a) => ({
      roomUnitId,
      entryKind: "RESERVATION" as const,
      entryId: a.reservationId,
      startDate: a.startDate,
      endDate: a.endDate,
    })),
    ...blocks.map((b) => ({
      roomUnitId,
      entryKind: "BLOCK" as const,
      entryId: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
    })),
    ...bookings.map((b: any) => ({
      roomUnitId,
      entryKind: "BOOKING" as const,
      entryId: b.id,
      startDate: b.checkIn,
      endDate: b.checkOut,
    })),
  ];
}
