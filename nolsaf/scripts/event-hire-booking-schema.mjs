// Inspect by default. --apply performs only the additive booking-name repair.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Match API environment precedence; never print credentials or connection URLs.
for (const name of ['.env.local', '.env']) {
  const path = resolve(root, 'apps/api', name);
  if (existsSync(path)) dotenv.config({ path, override: true, quiet: true });
}
for (const name of ['.env.local', '.env']) {
  const path = resolve(root, name);
  if (existsSync(path)) dotenv.config({ path, override: false, quiet: true });
}

const { prisma: db } = await import('@nolsaf/prisma');
const apply = process.argv.includes('--apply');
try {
  const columns = await db.$queryRawUnsafe(
    "SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='event_hire_booking'"
  );
  if (!columns.length) throw new Error('Booking table is absent; apply the approved workspace migration first.');
  const existing = new Map(columns.map(c => [c.name, c]));
  console.log('Booking snapshot fields:', JSON.stringify(['clientName', 'venueTitle'].map(name => ({ name, ...(existing.get(name) || { missing: true }) }))));
  const history = await db.$queryRawUnsafe(
    "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name LIKE '%event_hire%' ORDER BY migration_name"
  );
  console.log('Event migration history:', JSON.stringify(history));
  if (!apply) {
    console.log('Read-only inspection complete. Use --apply for the additive repair.');
  } else {
    // Nullable additions allow existing rows to be backfilled before enforcement.
    // Static identifiers and SQL only; no user input is interpolated into SQL.
    for (const [name, length] of [['clientName', 160], ['venueTitle', 200]]) {
      if (!existing.has(name)) {
        await db.$executeRawUnsafe(`ALTER TABLE event_hire_booking ADD COLUMN \`${name}\` VARCHAR(${length}) NULL`);
        console.log('Added', name);
      }
    }
    const updated = await db.$executeRawUnsafe(`
      UPDATE event_hire_booking b
      LEFT JOIN event_hire_request r ON r.id=b.requestId
      LEFT JOIN \`user\` u ON u.id=r.clientUserId
      LEFT JOIN property p ON p.id=r.propertyId
      SET b.clientName=COALESCE(NULLIF(TRIM(b.clientName),''),LEFT(COALESCE(NULLIF(TRIM(u.fullName),''),NULLIF(TRIM(u.name),''),'NoLSAF client'),160)),
          b.venueTitle=COALESCE(NULLIF(TRIM(b.venueTitle),''),LEFT(COALESCE(NULLIF(TRIM(p.title),''),'Event venue'),200))
      WHERE b.clientName IS NULL OR TRIM(b.clientName)='' OR b.venueTitle IS NULL OR TRIM(b.venueTitle)=''
    `);
    console.log('Backfilled existing booking rows:', updated);
    await db.$executeRawUnsafe('ALTER TABLE event_hire_booking MODIFY COLUMN clientName VARCHAR(160) NOT NULL, MODIFY COLUMN venueTitle VARCHAR(200) NOT NULL');
    console.log('BOOKING_SCHEMA_REPAIR_OK: both snapshot fields enforced.');
    console.log('No migration-history rows were changed. Include the forward repair migration in the next approved release.');
  }
  if (apply || process.argv.includes('--verify')) {
    // Exercise the /bookings projection. Never print private booking data.
    await db.eventHireBooking.findMany({
      include: {
        request: { include: { property: { select: { title: true, ownerId: true, status: true, rentalMode: true, eventHire: { select: { status: true, termsFingerprint: true, approvedFingerprint: true } } } } } },
        claims: true,
        transfers: true,
        evidence: true
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1
    });
    console.log('BOOKING_QUERY_OK: Prisma booking read with request, venue, claims, transfers and evidence passed.');
  }
} catch (error) {
  console.error('BOOKING_SCHEMA_CHECK_FAILED', { code: error.code || 'ERROR', message: String(error.message || '').replace(/mysql:\/\/\S+/g, '[redacted]') });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
