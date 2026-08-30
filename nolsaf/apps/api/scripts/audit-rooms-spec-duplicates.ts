/**
 * Read-only room-code migration audit. Writes nothing.
 *
 * Despite the historical filename, this now audits every property whose
 * roomsSpec would gain a stable code, plus every persisted Booking.roomCode
 * and PropertyAvailabilityBlock.roomCode that may need reconciliation.
 *
 *   npx tsx scripts/audit-rooms-spec-duplicates.ts
 */
import path from "node:path";
import dotenv from "dotenv";
import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../src/lib/bookingStatus.js";
import {
  buildRoomCodeBackfillPlan,
  type RoomCodeReference,
} from "../src/lib/roomCodeBackfill.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const activeStatuses = new Set<string>(AVAILABILITY_BLOCKING_BOOKING_STATUSES);

async function main() {
  const now = new Date();
  const properties = await prisma.property.findMany({
    select: { id: true, title: true, roomsSpec: true },
    orderBy: { id: "asc" },
  });

  const affected: any[] = [];
  let referenceUpdates = 0;
  let activeBlockers = 0;
  let unresolvedHistorical = 0;

  for (const property of properties) {
    const [bookings, blocks, units] = await Promise.all([
      prisma.booking.findMany({
        where: { propertyId: property.id, roomCode: { not: null } },
        select: { id: true, roomCode: true, status: true, checkOut: true },
        orderBy: { id: "asc" },
      }),
      prisma.propertyAvailabilityBlock.findMany({
        where: { propertyId: property.id, roomCode: { not: null } },
        select: { id: true, roomCode: true, endDate: true },
        orderBy: { id: "asc" },
      }),
      prisma.roomUnit.findMany({
        where: { propertyId: property.id },
        select: { code: true },
      }),
    ]);

    const references: RoomCodeReference[] = [
      ...bookings.map((booking) => ({
        kind: "booking" as const,
        id: booking.id,
        roomCode: booking.roomCode,
        active: activeStatuses.has(String(booking.status)) && booking.checkOut > now,
      })),
      ...blocks.map((block) => ({
        kind: "availabilityBlock" as const,
        id: block.id,
        roomCode: block.roomCode,
        active: block.endDate > now,
      })),
    ];
    const plan = buildRoomCodeBackfillPlan({
      roomsSpec: property.roomsSpec,
      references,
      protectedRoomUnitCodes: units.map((unit) => unit.code),
    });

    if (
      !plan.roomsSpecChanged &&
      plan.updates.length === 0 &&
      plan.activeBlockers.length === 0 &&
      plan.unresolvedHistorical.length === 0
    ) continue;

    referenceUpdates += plan.updates.length;
    activeBlockers += plan.activeBlockers.length;
    unresolvedHistorical += plan.unresolvedHistorical.length;
    affected.push({
      propertyId: property.id,
      title: property.title ?? null,
      roomsSpecChanged: plan.roomsSpecChanged,
      targetCodes: plan.codes,
      referenceUpdates: plan.updates,
      activeBlockers: plan.activeBlockers.map((decision) => ({
        kind: decision.kind,
        id: decision.id,
        roomCode: decision.roomCode,
        resolution: decision.resolution,
      })),
      unresolvedHistorical: plan.unresolvedHistorical.map((decision) => ({
        kind: decision.kind,
        id: decision.id,
        roomCode: decision.roomCode,
        resolution: decision.resolution,
      })),
    });
  }

  console.log(JSON.stringify({
    ok: activeBlockers === 0,
    mode: "read-only-audit",
    auditedAt: now.toISOString(),
    propertiesScanned: properties.length,
    propertiesAffected: affected.length,
    referenceUpdates,
    activeBlockers,
    unresolvedHistorical,
    safeToApply: activeBlockers === 0,
    affected,
  }, null, 2));

  if (activeBlockers > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.DATABASE_URL) await prisma.$disconnect();
  });
