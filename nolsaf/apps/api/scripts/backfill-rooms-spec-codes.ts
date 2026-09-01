/**
 * Backfill stable roomsSpec codes and safely reconcile persisted references.
 *
 * Dry-run is the default. --apply writes only after a complete preflight finds
 * zero active ambiguous/unknown references. Every property is locked and
 * rechecked in its own transaction before writes, making reruns safe while
 * avoiding one long production-wide transaction.
 *
 *   npx tsx scripts/backfill-rooms-spec-codes.ts
 *   npx tsx scripts/backfill-rooms-spec-codes.ts --apply
 */
import path from "node:path";
import dotenv from "dotenv";
import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../src/lib/bookingStatus.js";
import {
  buildRoomCodeBackfillPlan,
  type RoomCodeBackfillPlan,
  type RoomCodeReference,
} from "../src/lib/roomCodeBackfill.js";
import { roomsSpecEntries } from "../src/lib/roomSelectionCode.js";

// Workspace scripts run with apps/api as cwd. Production already supplies the
// variable through Elastic Beanstalk; local operators get the repository env.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const apply = process.argv.includes("--apply");
const activeStatuses = new Set<string>(AVAILABILITY_BLOCKING_BOOKING_STATUSES);

type LoadedPlan = {
  propertyId: number;
  title: string | null;
  plan: RoomCodeBackfillPlan;
};

async function loadPlan(db: any, propertyId: number, now: Date): Promise<LoadedPlan | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, title: true, roomsSpec: true },
  });
  if (!property || roomsSpecEntries(property.roomsSpec).length === 0) return null;

  const [bookings, blocks, units] = await Promise.all([
    db.booking.findMany({
      where: { propertyId, roomCode: { not: null } },
      select: { id: true, roomCode: true, status: true, checkOut: true },
      orderBy: { id: "asc" },
    }),
    db.propertyAvailabilityBlock.findMany({
      where: { propertyId, roomCode: { not: null } },
      select: { id: true, roomCode: true, endDate: true },
      orderBy: { id: "asc" },
    }),
    db.roomUnit.findMany({
      where: { propertyId },
      select: { code: true },
    }),
  ]);

  const references: RoomCodeReference[] = [
    ...bookings.map((booking: any) => ({
      kind: "booking" as const,
      id: booking.id,
      roomCode: booking.roomCode,
      active: activeStatuses.has(String(booking.status)) && booking.checkOut > now,
    })),
    ...blocks.map((block: any) => ({
      kind: "availabilityBlock" as const,
      id: block.id,
      roomCode: block.roomCode,
      active: block.endDate > now,
    })),
  ];

  return {
    propertyId: property.id,
    title: property.title ?? null,
    plan: buildRoomCodeBackfillPlan({
      roomsSpec: property.roomsSpec,
      references,
      protectedRoomUnitCodes: units.map((unit: any) => unit.code),
    }),
  };
}

function needsWork(loaded: LoadedPlan): boolean {
  return loaded.plan.roomsSpecChanged || loaded.plan.updates.length > 0;
}

function blockerSummary(loaded: LoadedPlan) {
  return {
    propertyId: loaded.propertyId,
    title: loaded.title,
    blockers: loaded.plan.activeBlockers.map((decision) => ({
      kind: decision.kind,
      id: decision.id,
      roomCode: decision.roomCode,
      resolution: decision.resolution,
    })),
  };
}

async function main() {
  const startedAt = new Date();
  const propertyIds = await prisma.property.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const preflight: LoadedPlan[] = [];
  for (const row of propertyIds) {
    const loaded = await loadPlan(prisma, row.id, startedAt);
    if (loaded) preflight.push(loaded);
  }

  const work = preflight.filter(needsWork);
  const blocked = preflight.filter((loaded) => loaded.plan.activeBlockers.length > 0);
  const plannedReferenceUpdates = preflight.reduce((sum, loaded) => sum + loaded.plan.updates.length, 0);
  const unresolvedHistorical = preflight.reduce(
    (sum, loaded) => sum + loaded.plan.unresolvedHistorical.length,
    0,
  );

  if (!apply || blocked.length > 0) {
    console.log(JSON.stringify({
      ok: blocked.length === 0,
      mode: apply ? "apply-blocked" : "dry-run",
      scanned: propertyIds.length,
      propertiesWithRoomsSpec: preflight.length,
      propertiesToChange: work.length,
      plannedReferenceUpdates,
      activeBlockers: blocked.reduce((sum, loaded) => sum + loaded.plan.activeBlockers.length, 0),
      unresolvedHistorical,
      safeToApply: blocked.length === 0,
      preview: work.slice(0, 50).map((loaded) => ({
        propertyId: loaded.propertyId,
        title: loaded.title,
        roomsSpecChanged: loaded.plan.roomsSpecChanged,
        codes: loaded.plan.codes,
        referenceUpdates: loaded.plan.updates,
      })),
      blocked: blocked.map(blockerSummary),
    }, null, 2));
    if (apply && blocked.length > 0) process.exitCode = 2;
    return;
  }

  let propertiesChanged = 0;
  let bookingsUpdated = 0;
  let blocksUpdated = 0;

  for (const candidate of work) {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT id FROM \`property\` WHERE id = ${candidate.propertyId} FOR UPDATE`;
      const current = await loadPlan(tx, candidate.propertyId, new Date());
      if (!current) return { propertyChanged: false, bookings: 0, blocks: 0 };
      if (current.plan.activeBlockers.length > 0) {
        const error = new Error(`ROOM_CODE_BACKFILL_BLOCKED:${candidate.propertyId}`);
        (error as any).details = blockerSummary(current);
        throw error;
      }

      const bookingUpdates = current.plan.updates.filter((update) => update.kind === "booking");
      const blockUpdates = current.plan.updates.filter((update) => update.kind === "availabilityBlock");
      for (const update of bookingUpdates) {
        await tx.booking.update({ where: { id: update.id }, data: { roomCode: update.targetCode } });
      }
      for (const update of blockUpdates) {
        await tx.propertyAvailabilityBlock.update({
          where: { id: update.id },
          data: { roomCode: update.targetCode },
        });
      }
      if (current.plan.roomsSpecChanged) {
        await tx.property.update({
          where: { id: candidate.propertyId },
          data: { roomsSpec: current.plan.after as any },
        });
      }

      return {
        propertyChanged: current.plan.roomsSpecChanged,
        bookings: bookingUpdates.length,
        blocks: blockUpdates.length,
      };
    });

    if (result.propertyChanged) propertiesChanged += 1;
    bookingsUpdated += result.bookings;
    blocksUpdated += result.blocks;
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    scanned: propertyIds.length,
    propertiesChanged,
    bookingsUpdated,
    availabilityBlocksUpdated: blocksUpdated,
    unresolvedHistorical,
  }, null, 2));
}

main()
  .catch((error: any) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message ?? String(error),
      details: error?.details ?? null,
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.DATABASE_URL) await prisma.$disconnect();
  });
