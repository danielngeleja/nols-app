// apps/api/src/lib/nrmsRateFloor.ts
//
// The lowest rate a staff member may agree.
//
// A group block's room line carries a nightly rate typed by whoever agreed the
// business, and that rate becomes the guest's rate: nrmsGroupPickup writes it
// to Reservation.roomRate and totalAmount. The only check on it was that it is
// a number and not negative.
//
// While agreeing a block was owner-only that was an owner pricing their own
// rooms. Once a manager or a sales executive can agree one, the same unbounded
// field is an unbounded discount authority, so this is where the bound lives.
//
// The rule, in one line: discount authority is granted, not assumed.
//
//   RoomType.staffRateFloor set     that number is the floor
//   staffRateFloor is NULL          the floor is RoomType.baseRate
//   staffRateFloor is 0             no floor, staff may agree any rate
//   baseRate is NULL too            nothing to floor against, unrestricted
//
// The owner is never floored. They are the one who sets it, and a limit a
// person can lift in one click and re-apply afterwards is theatre, not control.

import { typedPrisma as prisma } from "@nolsaf/prisma";

export type StaffRateFloorViolation = {
  roomTypeId: number;
  roomTypeName: string;
  offered: number;
  floor: number;
  currency: string;
  /** True when the floor came from baseRate because none was configured. */
  derivedFromBaseRate: boolean;
};

export type StaffRateFloorCheck =
  | { ok: true }
  | { ok: false; violations: StaffRateFloorViolation[]; message: string };

/** Roles that price their own rooms rather than being priced for. */
export function roleIsRateFloored(role: string): boolean {
  return role !== "OWNER";
}

function moneyLabel(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * @param lines The room lines as offered. A line with no rate is not checked:
 *   the block create schema treats a missing rate as zero, and a deliberate
 *   zero from an owner is a decision, not an omission to police here.
 */
export async function checkStaffRateFloor(input: {
  role: string;
  propertyId: number;
  lines: Array<{ roomTypeId: number; nightlyRate: number }>;
}): Promise<StaffRateFloorCheck> {
  if (!roleIsRateFloored(input.role)) return { ok: true };
  const roomTypeIds = [...new Set(input.lines.map((line) => line.roomTypeId))];
  if (roomTypeIds.length === 0) return { ok: true };

  const roomTypes = await prisma.roomType.findMany({
    where: { id: { in: roomTypeIds }, propertyId: input.propertyId },
    select: { id: true, name: true, baseRate: true, staffRateFloor: true, currency: true },
  });
  const byId = new Map(roomTypes.map((roomType: any) => [roomType.id, roomType]));

  const violations: StaffRateFloorViolation[] = [];
  for (const line of input.lines) {
    const roomType: any = byId.get(line.roomTypeId);
    // A room type that does not belong to this property is somebody else's
    // problem: the handler's own capacity check refuses it with a clearer
    // message than a rate floor ever could.
    if (!roomType) continue;

    const configured = roomType.staffRateFloor == null ? null : Number(roomType.staffRateFloor);
    const base = roomType.baseRate == null ? null : Number(roomType.baseRate);
    const floor = configured ?? base;
    // No floor to apply: either the owner lifted it with a zero, or the room
    // type has never been priced at all.
    if (floor == null || floor <= 0) continue;
    if (line.nightlyRate >= floor) continue;

    violations.push({
      roomTypeId: roomType.id,
      roomTypeName: roomType.name,
      offered: line.nightlyRate,
      floor,
      currency: roomType.currency ?? "TZS",
      derivedFromBaseRate: configured == null,
    });
  }

  if (violations.length === 0) return { ok: true };

  // One sentence per room type, and it says what to do next. A refusal that
  // only says "not allowed" sends the person to find a manager without knowing
  // what number would have worked.
  const detail = violations
    .map((violation) => `${violation.roomTypeName} at ${moneyLabel(violation.offered, violation.currency)} is below the ${moneyLabel(violation.floor, violation.currency)} limit`)
    .join("; ");
  const anyDerived = violations.some((violation) => violation.derivedFromBaseRate);
  const guidance = anyDerived
    ? "No lower limit has been set for this room type, so the standard rate applies. The owner can set one to give the sales team room to negotiate."
    : "Ask the owner to agree this rate, or to lower the limit for this room type.";

  return { ok: false, violations, message: `${detail}. ${guidance}` };
}
