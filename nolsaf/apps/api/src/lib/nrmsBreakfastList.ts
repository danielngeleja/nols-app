/**
 * Breakfast list — the sheet the restaurant works the morning service from.
 *
 * Built the way a PMS builds it, from the stays that slept in the house, not
 * from today's arrivals:
 *
 *   Breakfast on the morning of D belongs to the night of D-1. So a room is on
 *   the list when its allocation started on or before D-1 and had not ended
 *   before D. The departure morning IS included (a guest checking out at 10am
 *   eats first); the arrival morning is NOT (a guest arriving at 22:00 eats
 *   tomorrow). Expressed against the half-open [startDate, endDate) allocation
 *   range that is: startDate < D and endDate >= D.
 *
 * Entitlement comes from the meal plan snapshotted on the allocation when the
 * room was sold. A NULL plan is shown as "Verify" and still printed, because a
 * guest wrongly turned away at the buffet is a complaint while a guest wrongly
 * fed is only a cost.
 *
 * Pax note: adults and children are held on the reservation, not per room, so
 * a party across several rooms cannot be split between them without inventing
 * numbers. Each of its rows therefore shows the party's pax and carries a
 * remark naming the share, while the totals count that party once. Covers on
 * this sheet are people, not rooms.
 */

import { prisma } from "@nolsaf/prisma";
import { includesBreakfast, mealPlanLabel } from "./nrmsMealPlan.js";

/** Stays that can legitimately eat: cancelled, no-show, expired, draft and held never appear. */
const SERVICEABLE_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

export interface BreakfastListRow {
  sn: number;
  reservationId: number;
  allocationId: number;
  fullName: string;
  roomType: string;
  roomNo: string;
  floor: number | null;
  adults: number;
  children: number;
  mealPlan: string | null;
  mealPlanLabel: string;
  entitled: boolean;
  /** Pre-filled only where the system genuinely knows something. Otherwise blank for the restaurant to write in. */
  remark: string;
}

export interface BreakfastListTotals {
  rooms: number;
  parties: number;
  adults: number;
  children: number;
  covers: number;
  entitledRooms: number;
  entitledCovers: number;
  unverified: number;
}

export interface BreakfastList {
  serviceDate: string;
  nightOf: string;
  property: { id: number; title: string };
  rows: BreakfastListRow[];
  totals: BreakfastListTotals;
  generatedAt: Date;
}

/** Midnight UTC for a YYYY-MM-DD business date. Allocation dates are stored as date-only midnights, so this compares exactly. */
function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function buildBreakfastList(params: {
  propertyId: number;
  propertyTitle: string;
  serviceDate: string;
  /** When set, rooms with no breakfast entitlement are dropped instead of being listed as ROOM_ONLY. */
  entitledOnly?: boolean;
}): Promise<BreakfastList> {
  const service = dayStart(params.serviceDate);

  const allocations = await prisma.reservationRoomAllocation.findMany({
    where: {
      status: "ACTIVE",
      startDate: { lt: service },
      endDate: { gte: service },
      reservation: { propertyId: params.propertyId, status: { in: SERVICEABLE_STATUSES } },
    },
    select: {
      id: true,
      mealPlan: true,
      endDate: true,
      roomType: { select: { name: true } },
      roomUnit: { select: { code: true, floor: true } },
      reservation: {
        select: {
          id: true,
          status: true,
          adults: true,
          children: true,
          checkOut: true,
          guestProfile: { select: { fullName: true } },
          group: { select: { name: true } },
        },
      },
    },
  });

  // Room number order: that is how the floor is worked. Unassigned rooms sort
  // last, since they need the desk before they need the kitchen.
  const sorted = allocations.sort((a, b) => {
    const left = a.roomUnit?.code ?? "";
    const right = b.roomUnit?.code ?? "";
    if (!left && right) return 1;
    if (left && !right) return -1;
    return left.localeCompare(right, undefined, { numeric: true }) || a.id - b.id;
  });

  const roomsPerReservation = new Map<number, number>();
  for (const allocation of sorted) {
    roomsPerReservation.set(allocation.reservation.id, (roomsPerReservation.get(allocation.reservation.id) ?? 0) + 1);
  }

  const rows: BreakfastListRow[] = [];
  const countedParties = new Set<number>();
  const totals: BreakfastListTotals = {
    rooms: 0,
    parties: 0,
    adults: 0,
    children: 0,
    covers: 0,
    entitledRooms: 0,
    entitledCovers: 0,
    unverified: 0,
  };

  for (const allocation of sorted) {
    const reservation = allocation.reservation;
    const entitled = includesBreakfast(allocation.mealPlan);
    if (params.entitledOnly && !entitled) continue;

    const shared = roomsPerReservation.get(reservation.id) ?? 1;
    const notes: string[] = [];
    if (reservation.group?.name) notes.push(reservation.group.name);
    if (shared > 1) notes.push(`party over ${shared} rooms`);
    // Departure morning: the kitchen and the desk both want this visible,
    // because the guest is eating and leaving in the same hour.
    if (isoDay(new Date(reservation.checkOut)) === params.serviceDate) notes.push("departing today");
    if (reservation.status === "CONFIRMED") notes.push("not checked in");
    if (!allocation.roomUnit?.code) notes.push("room not assigned");

    rows.push({
      sn: rows.length + 1,
      reservationId: reservation.id,
      allocationId: allocation.id,
      fullName: reservation.guestProfile?.fullName || "Guest",
      roomType: allocation.roomType?.name ?? "Room",
      roomNo: allocation.roomUnit?.code ?? "",
      floor: allocation.roomUnit?.floor ?? null,
      adults: reservation.adults,
      children: reservation.children,
      mealPlan: allocation.mealPlan,
      mealPlanLabel: mealPlanLabel(allocation.mealPlan),
      entitled,
      remark: notes.join(", "),
    });

    totals.rooms += 1;
    if (entitled) totals.entitledRooms += 1;
    if (!allocation.mealPlan) totals.unverified += 1;

    // Pax is a property of the party, so it is counted once however many rooms
    // that party occupies. Counting per row would double the kitchen's order.
    if (!countedParties.has(reservation.id)) {
      countedParties.add(reservation.id);
      totals.parties += 1;
      totals.adults += reservation.adults;
      totals.children += reservation.children;
      if (entitled) totals.entitledCovers += reservation.adults + reservation.children;
    }
  }

  totals.covers = totals.adults + totals.children;

  return {
    serviceDate: params.serviceDate,
    nightOf: isoDay(addDays(service, -1)),
    property: { id: params.propertyId, title: params.propertyTitle },
    rows,
    totals,
    generatedAt: new Date(),
  };
}
