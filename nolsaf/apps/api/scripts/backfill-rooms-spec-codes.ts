/**
 * Give every existing Property.roomsSpec entry a stable `code`.
 *
 * Owners save rooms that differ in beds or price as separate options, so a
 * property can hold several entries sharing one room type. Without a code they
 * collapse to the same identity, and availability, pricing, payment, and NRMS
 * all resolve to whichever entry happens to come first.
 *
 * Runs read-only by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-rooms-spec-codes.ts            # dry run, prints a plan
 *   npx tsx scripts/backfill-rooms-spec-codes.ts --apply    # writes
 *
 * Safe to re-run: entries that already carry a code are left untouched.
 */
import { prisma } from "@nolsaf/prisma";
import { ensureRoomsSpecCodes } from "../src/lib/roomSelectionCode.js";

const apply = process.argv.includes("--apply");
const batchSize = Number(process.env.BATCH_SIZE ?? 200);

function sameCodes(before: unknown[], after: unknown[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((entry, index) => {
    const a = (entry && typeof entry === "object" ? (entry as any).code : null) ?? null;
    const b = (after[index] && typeof after[index] === "object" ? (after[index] as any).code : null) ?? null;
    return a === b;
  });
}

async function main() {
  let cursor = 0;
  let scanned = 0;
  let changed = 0;
  const preview: Array<{ propertyId: number; codes: string[] }> = [];

  for (;;) {
    const rows = await prisma.property.findMany({
      where: { id: { gt: cursor } },
      select: { id: true, roomsSpec: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });

    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      const before = row.roomsSpec;
      if (!Array.isArray(before) || before.length === 0) continue;

      const after = ensureRoomsSpecCodes(before as unknown[]);
      if (sameCodes(before as unknown[], after)) continue;

      changed++;
      if (preview.length < 20) {
        preview.push({
          propertyId: row.id,
          codes: after.map((entry: any) => String(entry?.code ?? "")),
        });
      }

      if (apply) {
        await prisma.property.update({
          where: { id: row.id },
          data: { roomsSpec: after as any },
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      { ok: true, mode: apply ? "apply" : "dry-run", scanned, changed, preview },
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
