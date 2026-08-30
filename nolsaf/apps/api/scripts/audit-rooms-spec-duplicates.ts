/**
 * Read-only. Writes nothing.
 *
 * Lists properties that publish two or more roomsSpec options under one room
 * type, and counts the bookings already sold against those properties.
 *
 * Those bookings store the room type as their roomCode. Once the property's
 * options carry per-variant codes, the room type no longer matches any bucket,
 * so each of these bookings has to be decided on before the backfill runs.
 *
 *   npx tsx scripts/audit-rooms-spec-duplicates.ts
 */
import { prisma } from "@nolsaf/prisma";

const BLOCKING = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN"];

function roomTypeOf(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const source = entry as Record<string, unknown>;
  for (const value of [source.roomType, source.type, source.name, source.label]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function main() {
  const properties = await prisma.property.findMany({
    select: { id: true, title: true, roomsSpec: true },
    orderBy: { id: "asc" },
  });

  const affected: Array<{
    propertyId: number;
    title: string | null;
    duplicatedTypes: string[];
    alreadyCoded: number;
    liveBookings: number;
    liveBookingRoomCodes: string[];
  }> = [];

  for (const property of properties) {
    const spec = property.roomsSpec;
    if (!Array.isArray(spec) || spec.length < 2) continue;

    const counts = new Map<string, number>();
    for (const entry of spec) {
      const key = roomTypeOf(entry).toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const duplicated = Array.from(counts.entries()).filter(([, n]) => n > 1);
    if (!duplicated.length) continue;

    const bookings = await prisma.booking.findMany({
      where: { propertyId: property.id, status: { in: BLOCKING as any } },
      select: { roomCode: true },
    });

    affected.push({
      propertyId: property.id,
      title: property.title ?? null,
      duplicatedTypes: duplicated.map(([type, n]) => `${type} x${n}`),
      alreadyCoded: spec.filter(
        (entry: any) => typeof entry?.code === "string" && entry.code.trim() !== "",
      ).length,
      liveBookings: bookings.length,
      liveBookingRoomCodes: Array.from(
        new Set(bookings.map((b) => String(b.roomCode ?? "(null)"))),
      ),
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        propertiesScanned: properties.length,
        propertiesWithDuplicateRoomTypes: affected.length,
        liveBookingsOnThoseProperties: affected.reduce((sum, a) => sum + a.liveBookings, 0),
        affected,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
