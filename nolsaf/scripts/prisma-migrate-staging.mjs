import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import prismaPackage from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const { PrismaClient } = prismaPackage;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..");
const schemaPath = join(repoRoot, "prisma", "schema.prisma");
const migrationsPath = join(repoRoot, "prisma", "migrations");
const prismaCliPath = join(repoRoot, "node_modules", "prisma", "build", "index.js");

const args = new Set(process.argv.slice(2));
const statusOnly = args.has("--status-only");
const cleanupFailedBaselineArtifacts = args.has(
  "--cleanup-failed-baseline-artifacts",
);
const useCurrentEnvironment = args.has("--use-current-env");
const envArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--env-file="));
const envPath = envArgument
  ? envArgument.slice("--env-file=".length)
  : join("apps", "api", ".env.staging");

if (!useCurrentEnvironment) {
  const resolvedEnvPath = isAbsolute(envPath) ? envPath : resolve(repoRoot, envPath);
  if (!existsSync(resolvedEnvPath)) {
    fail(`Staging environment file not found: ${resolvedEnvPath}`);
  }
  const result = dotenv.config({ path: resolvedEnvPath, override: true, quiet: true });
  if (result.error) fail(`Unable to load staging environment file: ${resolvedEnvPath}`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required.");

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  fail("DATABASE_URL is not a valid URL.");
}

const approvedStagingHosts = new Set([
  "mysql-2f403a3f-nolsaf.l.aivencloud.com",
]);
if (!approvedStagingHosts.has(parsedDatabaseUrl.hostname)) {
  fail(
    `Refusing to run against unapproved staging host ${parsedDatabaseUrl.hostname}. ` +
      "Update the allowlist in scripts/prisma-migrate-staging.mjs after verifying the target.",
  );
}
if (["localhost", "127.0.0.1", "::1"].includes(parsedDatabaseUrl.hostname)) {
  fail("Refusing to run the staging migration workflow against a local database.");
}

console.log(
  `[prisma:staging] Target ${parsedDatabaseUrl.hostname}:${parsedDatabaseUrl.port || "3306"}/` +
    parsedDatabaseUrl.pathname.replace(/^\//, ""),
);

const renamedBaseline = "20250101000000_baseline";
const legacyBaseline = "20251213210000_baseline";
const historicalPrerequisites = [
  "20260228000000_add_agent_progression_fields",
  "20260509060000_create_site_updates",
  "20260622000000_create_agent_reviews",
];
const legacyReconciliation = "20260714130000_reconcile_legacy_database_drift";
const legacyIndexReconciliation = "20260714195920";
const nrmsStaffInviteHardening = "20260720120000_harden_nrms_staff_invites";
const nrmsStaffInviteRepair =
  "20260720123000_repair_nrms_staff_invite_hardening";
const allowedLegacyDatabaseMigrations = new Set([
  legacyBaseline,
  "20260106185415_add_performance_indexes",
]);
let prisma;

let migrationRows = await readMigrationRows();

if (cleanupFailedBaselineArtifacts) {
  await cleanupRenamedBaselineArtifacts(migrationRows);
}

if (statusOnly) {
  const healthy = printStatus(migrationRows);
  process.exit(healthy ? 0 : 2);
}

const appliedNames = getAppliedNames(migrationRows);
const activeFailures = getActiveFailures(migrationRows);
const repairs = [];

// The original invite-hardening migration predates the idempotent repair. If
// MySQL stopped it after partially committing DDL, treating it as rolled back
// and replaying it can fail on columns or indexes that already exist. Mark the
// failed original as applied and let the following repair establish every
// required invariant conditionally.
if (activeFailures.has(nrmsStaffInviteHardening)) {
  repairs.push(["--applied", nrmsStaffInviteHardening]);
}

// The repair itself is idempotent. A failed attempt can therefore be marked
// rolled back and safely replayed from its corrected, committed SQL.
if (activeFailures.has(nrmsStaffInviteRepair)) {
  repairs.push(["--rolled-back", nrmsStaffInviteRepair]);
}

if (!appliedNames.has(renamedBaseline)) {
  const legacyRow = migrationRows.find(
    (row) => row.migration_name === legacyBaseline && row.finished_at && !row.rolled_back_at,
  );
  if (!legacyRow) {
    fail(
      `Cannot safely repair ${renamedBaseline}: applied legacy baseline ${legacyBaseline} was not found.`,
    );
  }

  const localBaseline = readFileSync(
    join(migrationsPath, renamedBaseline, "migration.sql"),
  );
  const localChecksum = createHash("sha256").update(localBaseline).digest("hex");
  if (legacyRow.checksum !== localChecksum) {
    fail(
      `Cannot safely alias ${legacyBaseline} to ${renamedBaseline}: SQL checksums differ.`,
    );
  }

  if (activeFailures.has(renamedBaseline)) {
    repairs.push(["--rolled-back", renamedBaseline]);
  }
  repairs.push(["--applied", renamedBaseline]);
}

if (!appliedNames.has(historicalPrerequisites[0])) {
  await assertColumnsExist("agent", [
    "level",
    "totalCompletedTrips",
    "totalRevenueGenerated",
  ]);
  repairs.push(["--applied", historicalPrerequisites[0]]);
}

if (!appliedNames.has(historicalPrerequisites[1])) {
  await assertTableExists("site_updates");
  repairs.push(["--applied", historicalPrerequisites[1]]);
}

if (!appliedNames.has(historicalPrerequisites[2])) {
  await assertTableExists("agent_reviews");
  repairs.push(["--applied", historicalPrerequisites[2]]);
}

let resolvedLegacyReconciliation = false;
if (!appliedNames.has(legacyReconciliation)) {
  const legacyTables = [
    "activity_costs",
    "chatbot_conversations",
    "chatbot_messages",
    "driver_reminders",
    "park_fees",
    "plan_request_messages",
    "pricing_rules",
    "savedproperty",
    "transport_cost_averages",
    "transportmessage",
    "trip_destinations",
    "trip_estimates",
    "visa_fees",
  ];
  const legacyColumnSets = [
    ["agent", ["restoredAt", "restoredBy"]],
    [
      "booking",
      [
        "driverId",
        "includeTransport",
        "transportFare",
        "transportOriginAddress",
        "transportScheduledDate",
        "transportVehicleType",
      ],
    ],
    [
      "group_bookings",
      [
        "femaleCount",
        "fromCountry",
        "maleCount",
        "minHotelStarLabel",
        "otherCount",
        "recommendedPropertyIds",
      ],
    ],
    ["jobapplication", ["agentApplicationData", "agentId"]],
    ["plan_requests", ["userId"]],
    ["property", ["buildingType", "totalFloors"]],
    [
      "transportbooking",
      [
        "arrivalNumber",
        "arrivalTime",
        "arrivalType",
        "driverRating",
        "driverReview",
        "pickupLocation",
        "transportCompany",
        "userRating",
        "userReview",
        "vehicleType",
      ],
    ],
    [
      "user",
      [
        "address",
        "avatarUrl",
        "dateOfBirth",
        "district",
        "fullName",
        "gender",
        "licenseNumber",
        "nationality",
        "nin",
        "operationArea",
        "paymentPhone",
        "paymentVerified",
        "plateNumber",
        "region",
        "timezone",
        "tin",
        "vehicleMake",
        "vehiclePlate",
        "vehicleType",
      ],
    ],
  ];

  const hasLegacyTables = await tablesExist(legacyTables);
  const hasLegacyColumns = await columnSetsExist(legacyColumnSets);
  if (hasLegacyTables && hasLegacyColumns) {
    if (activeFailures.has(legacyReconciliation)) {
      await restorePartiallyDroppedLegacyForeignKeys();
      repairs.push(["--rolled-back", legacyReconciliation]);
    }
    repairs.push(["--applied", legacyReconciliation]);
    resolvedLegacyReconciliation = true;
  } else if (activeFailures.has(legacyReconciliation)) {
    fail(
      `${legacyReconciliation} failed, but the legacy schema is not complete enough to baseline safely.`,
    );
  }
}

// This generated migration primarily normalizes constraint/index names after the
// legacy reconciliation. Existing staging already has the same indexes and
// relationships under older names. Resolve it together with the verified legacy
// schema, then enforce its functional FK/default semantics after deploy.
if (resolvedLegacyReconciliation && !appliedNames.has(legacyIndexReconciliation)) {
  repairs.push(["--applied", legacyIndexReconciliation]);
}

await disconnect();

for (const [resolution, migration] of repairs) {
  console.log(`[prisma:staging] Resolving verified history: ${migration} (${resolution})`);
  runPrisma(["migrate", "resolve", resolution, migration, `--schema=${schemaPath}`]);
}

console.log("[prisma:staging] Applying genuinely pending migrations...");
runPrisma(["migrate", "deploy", `--schema=${schemaPath}`]);

migrationRows = await readMigrationRows();
if (getAppliedNames(migrationRows).has(legacyIndexReconciliation)) {
  await reconcileLegacyIndexMigrationSemantics();
}
const healthy = printStatus(migrationRows);
await disconnect();
if (!healthy) fail("Migration deploy finished, but the migration history is not healthy.");

console.log("[prisma:staging] Staging migration deploy completed successfully.");

function createPrismaClient() {
  const sslMode =
    parsedDatabaseUrl.searchParams.get("ssl-mode") ??
    parsedDatabaseUrl.searchParams.get("sslmode");
  const sslAccept = parsedDatabaseUrl.searchParams.get("sslaccept");
  const wantsSsl = Boolean(sslMode || sslAccept);
  const adapter = new PrismaMariaDb({
    host: parsedDatabaseUrl.hostname,
    port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 3306,
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: parsedDatabaseUrl.pathname.replace(/^\//, ""),
    allowPublicKeyRetrieval: true,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 30_000,
    socketTimeout: 60_000,
    connectionLimit: 1,
  });
  return new PrismaClient({ adapter });
}

async function getPrisma() {
  if (!prisma) prisma = createPrismaClient();
  return prisma;
}

async function disconnect() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

async function readMigrationRows() {
  try {
    const client = await getPrisma();
    return await client.$queryRawUnsafe(`
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at, migration_name
    `);
  } catch (error) {
    await disconnect();
    failWithDatabaseError("Unable to read _prisma_migrations", error);
  }
}

function getAppliedNames(rows) {
  return new Set(
    rows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  );
}

function getActiveFailures(rows) {
  return new Set(
    rows
      .filter((row) => !row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  );
}

async function assertTableExists(tableName) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(?)`,
    tableName,
  );
  if (Number(rows[0]?.count ?? 0) !== 1) {
    await disconnect();
    fail(`Cannot mark historical prerequisite applied: table ${tableName} is missing.`);
  }
}

async function assertColumnsExist(tableName, columnNames) {
  const client = await getPrisma();
  const placeholders = columnNames.map(() => "?").join(", ");
  const rows = await client.$queryRawUnsafe(
    `SELECT LOWER(column_name) AS column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND LOWER(column_name) IN (${placeholders})`,
    tableName,
    ...columnNames.map((column) => column.toLowerCase()),
  );
  const found = new Set(rows.map((row) => row.column_name));
  const missing = columnNames.filter((column) => !found.has(column.toLowerCase()));
  if (missing.length > 0) {
    await disconnect();
    fail(
      `Cannot mark historical prerequisite applied: ${tableName} is missing columns ${missing.join(", ")}.`,
    );
  }
}

async function tablesExist(tableNames) {
  for (const tableName of tableNames) {
    const client = await getPrisma();
    const rows = await client.$queryRawUnsafe(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(?)`,
      tableName,
    );
    if (Number(rows[0]?.count ?? 0) !== 1) return false;
  }
  return true;
}

async function columnSetsExist(columnSets) {
  for (const [tableName, columnNames] of columnSets) {
    const client = await getPrisma();
    const placeholders = columnNames.map(() => "?").join(", ");
    const rows = await client.$queryRawUnsafe(
      `SELECT LOWER(column_name) AS column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND LOWER(table_name) = LOWER(?)
         AND LOWER(column_name) IN (${placeholders})`,
      tableName,
      ...columnNames.map((column) => column.toLowerCase()),
    );
    if (rows.length !== columnNames.length) return false;
  }
  return true;
}

async function restorePartiallyDroppedLegacyForeignKeys() {
  const foreignKeys = [
    ["adminaudit", "adminId", "adminaudit_adminId_fkey", "user", "id", "CASCADE"],
    ["adminnote", "adminId", "adminnote_adminId_fkey", "user", "id", "CASCADE"],
    ["adminnote", "ownerId", "adminnote_ownerId_fkey", "user", "id", "CASCADE"],
    ["adminotp", "adminId", "adminotp_adminId_fkey", "user", "id", "CASCADE"],
    ["agent", "userId", "agent_userId_fkey", "user", "id", "CASCADE"],
    ["auditlog", "actorId", "auditlog_actorId_fkey", "user", "id", "SET NULL"],
    ["booking", "propertyId", "booking_propertyId_fkey", "property", "id", "CASCADE"],
    ["booking", "userId", "booking_userId_fkey", "user", "id", "SET NULL"],
  ];
  for (const foreignKey of foreignKeys) await ensureForeignKey(...foreignKey);
}

async function reconcileLegacyIndexMigrationSemantics() {
  const updatedAtTables = [
    "guest_profile",
    "guest_sms_annual_quota",
    "guest_sms_campaign",
    "guest_sms_campaign_recipient",
    "guest_sms_preference",
    "owner_payg_account",
    "owner_service_enrollment",
    "property_verification",
    "reservation",
    "reservation_room_allocation",
    "room_type",
    "room_unit",
    "service_plan",
    "tour_bookings",
  ];
  for (const tableName of updatedAtTables) {
    await dropColumnDefaultIfPresent(tableName, "updatedAt");
  }

  const foreignKeys = [
    ["jobapplication", "jobId", "jobapplication_jobId_fkey", "job", "id", "CASCADE"],
    ["jobapplication", "reviewedBy", "jobapplication_reviewedBy_fkey", "user", "id", "SET NULL"],
    ["jobapplication", "agentId", "jobapplication_agentId_fkey", "agent", "id", "SET NULL"],
    ["savedproperty", "userId", "savedproperty_userId_fkey", "user", "id", "CASCADE"],
    ["savedproperty", "propertyId", "savedproperty_propertyId_fkey", "property", "id", "CASCADE"],
    ["propertyavailabilityblock", "propertyId", "propertyavailabilityblock_propertyId_fkey", "property", "id", "CASCADE"],
    ["propertyavailabilityblock", "ownerId", "propertyavailabilityblock_ownerId_fkey", "user", "id", "CASCADE"],
    ["trip_estimates", "userId", "trip_estimates_userId_fkey", "user", "id", "SET NULL"],
    ["trip_estimates", "bookingId", "trip_estimates_bookingId_fkey", "booking", "id", "SET NULL"],
  ];
  for (const foreignKey of foreignKeys) await ensureForeignKey(...foreignKey);

  await ensureIndex("booking", "idx_Booking_property_status_checkOut", [
    "propertyId",
    "status",
    "checkOut",
  ]);
  await ensureIndex("invoice", "invoice_checkoutSessionId_idx", ["checkoutSessionId"]);

  const indexRenames = [
    ["booking", "Booking_propertyId_checkIn_checkOut_idx", "booking_propertyId_checkIn_checkOut_idx"],
    ["payment_events", "payment_events_payment_channel_status_created_at_idx", "payment_events_payment_channel_status_createdAt_idx"],
    ["session", "Session_userId_revokedAt_idx", "session_userId_revokedAt_idx"],
    ["tour_bookings", "tour_bookings_operator_status_created_idx", "tour_bookings_operatorAgentId_status_createdAt_idx"],
    ["tour_bookings", "tour_bookings_payment_status_created_idx", "tour_bookings_paymentStatus_createdAt_idx"],
  ];
  for (const indexRename of indexRenames) await renameIndexIfNeeded(...indexRename);

  const foreignKeyNormalizations = [
    ["nrms_ledger_transaction", "propertyId", "nrms_ledger_transaction_propertyId_fkey", "property", "id", "CASCADE"],
    ["nrms_ledger_transaction", "businessDayId", "nrms_ledger_transaction_businessDayId_fkey", "nrms_business_day", "id", "RESTRICT"],
    ["nrms_ledger_transaction", "nightAuditRunId", "nrms_ledger_transaction_nightAuditRunId_fkey", "nrms_night_audit_run", "id", "SET NULL"],
    ["nrms_night_audit_run", "propertyId", "nrms_night_audit_run_propertyId_fkey", "property", "id", "CASCADE"],
    ["nrms_night_audit_run", "businessDayId", "nrms_night_audit_run_businessDayId_fkey", "nrms_business_day", "id", "RESTRICT"],
    ["nrms_night_audit_run", "startedById", "nrms_night_audit_run_startedById_fkey", "user", "id", "SET NULL"],
    ["nrms_night_audit_run", "closedById", "nrms_night_audit_run_closedById_fkey", "user", "id", "SET NULL"],
  ];
  for (const foreignKey of foreignKeyNormalizations) {
    await normalizeForeignKeyName(...foreignKey);
  }
}

async function ensureForeignKey(
  tableName,
  columnName,
  constraintName,
  referencedTable,
  referencedColumn,
  onDelete,
) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND LOWER(column_name) = LOWER(?)
       AND LOWER(referenced_table_name) = LOWER(?)
       AND LOWER(referenced_column_name) = LOWER(?)`,
    tableName,
    columnName,
    referencedTable,
    referencedColumn,
  );
  if (Number(rows[0]?.count ?? 0) > 0) return;

  console.log(`[prisma:staging] Restoring foreign key ${constraintName}.`);
  await client.$executeRawUnsafe(
    `ALTER TABLE \`${tableName}\`
     ADD CONSTRAINT \`${constraintName}\`
     FOREIGN KEY (\`${columnName}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
     ON DELETE ${onDelete} ON UPDATE CASCADE`,
  );
}

async function dropColumnDefaultIfPresent(tableName, columnName) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT column_default AS column_default
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND LOWER(column_name) = LOWER(?)`,
    tableName,
    columnName,
  );
  if (rows.length !== 1 || rows[0].column_default == null) return;
  await client.$executeRawUnsafe(
    `ALTER TABLE \`${tableName}\` ALTER COLUMN \`${columnName}\` DROP DEFAULT`,
  );
}

async function cleanupRenamedBaselineArtifacts(rows) {
  const legacyApplied = rows.some(
    (row) =>
      row.migration_name === legacyBaseline && row.finished_at && !row.rolled_back_at,
  );
  const renamedBaselineRolledBack = rows.some(
    (row) => row.migration_name === renamedBaseline && row.rolled_back_at,
  );
  if (!legacyApplied || !renamedBaselineRolledBack) {
    fail(
      "Refusing baseline-artifact cleanup: the verified legacy/renamed baseline history was not found.",
    );
  }

  // These are exactly statements 1-15 of the renamed baseline. MySQL committed
  // them before statement 16 failed on the already-existing group_bookings table.
  const artifactTables = [
    "Passkey",
    "UserDocument",
    "AdminNote",
    "PhoneOtp",
    "EmailVerificationToken",
    "AdminOtp",
    "Session",
    "AdminAudit",
    "AuditLog",
    "AdminIpAllow",
    "Invoice",
    "CheckinCode",
    "Booking",
    "Property",
    "User",
  ];
  const client = await getPrisma();
  const existing = [];

  for (const tableName of artifactTables) {
    const tableRows = await client.$queryRawUnsafe(
      `SELECT table_name AS table_name
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND BINARY table_name = BINARY ?`,
      tableName,
    );
    if (tableRows.length === 0) continue;
    existing.push(tableName);
    const countRows = await client.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM \`${tableName}\``,
    );
    const rowCount = Number(countRows[0]?.count ?? 0);
    if (rowCount !== 0) {
      fail(
        `Refusing baseline-artifact cleanup: exact-case table ${tableName} contains ${rowCount} rows.`,
      );
    }
  }

  if (existing.length === 0) {
    console.log("[prisma:staging] No failed-baseline artifact tables remain.");
    return;
  }

  console.log(
    `[prisma:staging] Removing ${existing.length} verified empty failed-baseline artifact tables.`,
  );
  for (const tableName of existing) {
    await client.$executeRawUnsafe(`DROP TABLE \`${tableName}\``);
  }
}

async function ensureIndex(tableName, indexName, columnNames) {
  const client = await getPrisma();
  const existing = await client.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND index_name = ?`,
    tableName,
    indexName,
  );
  if (Number(existing[0]?.count ?? 0) > 0) return;

  console.log(`[prisma:staging] Creating missing index ${indexName}.`);
  const columnsSql = columnNames.map((column) => `\`${column}\``).join(", ");
  await client.$executeRawUnsafe(
    `CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`,
  );
}

async function renameIndexIfNeeded(tableName, oldName, newName) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT index_name AS index_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND index_name IN (?, ?)
     GROUP BY index_name`,
    tableName,
    oldName,
    newName,
  );
  const names = new Set(rows.map((row) => row.index_name));
  if (names.has(newName) || !names.has(oldName)) return;
  console.log(`[prisma:staging] Renaming index ${oldName} to ${newName}.`);
  await client.$executeRawUnsafe(
    `ALTER TABLE \`${tableName}\` RENAME INDEX \`${oldName}\` TO \`${newName}\``,
  );
}

async function normalizeForeignKeyName(
  tableName,
  columnName,
  desiredName,
  referencedTable,
  referencedColumn,
  onDelete,
) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT constraint_name AS constraint_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND LOWER(table_name) = LOWER(?)
       AND LOWER(column_name) = LOWER(?)
       AND LOWER(referenced_table_name) = LOWER(?)
       AND LOWER(referenced_column_name) = LOWER(?)`,
    tableName,
    columnName,
    referencedTable,
    referencedColumn,
  );
  const names = rows.map((row) => row.constraint_name);
  if (names.includes(desiredName)) return;

  for (const oldName of names) {
    if (!/^[A-Za-z0-9_]+$/.test(oldName)) {
      fail(`Refusing to normalize unsafe foreign-key name: ${oldName}`);
    }
    console.log(`[prisma:staging] Replacing foreign key ${oldName} with ${desiredName}.`);
    await client.$executeRawUnsafe(
      `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${oldName}\``,
    );
  }
  await ensureForeignKey(
    tableName,
    columnName,
    desiredName,
    referencedTable,
    referencedColumn,
    onDelete,
  );
}

function localMigrationNames() {
  return readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function printStatus(rows) {
  const local = localMigrationNames();
  const localSet = new Set(local);
  const applied = getAppliedNames(rows);
  const failures = [...getActiveFailures(rows)].sort();
  const pending = local.filter((migration) => !applied.has(migration));
  const unexpectedDatabaseOnly = [...applied]
    .filter(
      (migration) =>
        !localSet.has(migration) && !allowedLegacyDatabaseMigrations.has(migration),
    )
    .sort();

  console.log(`[prisma:staging] ${local.length} local migrations, ${pending.length} pending.`);
  if (pending.length > 0) console.log(`[prisma:staging] Pending: ${pending.join(", ")}`);
  if (failures.length > 0) console.log(`[prisma:staging] Failed: ${failures.join(", ")}`);
  if (unexpectedDatabaseOnly.length > 0) {
    console.log(
      `[prisma:staging] Unexpected database-only migrations: ${unexpectedDatabaseOnly.join(", ")}`,
    );
  }
  if (allowedLegacyDatabaseMigrations.size > 0) {
    const presentAliases = [...allowedLegacyDatabaseMigrations].filter((name) =>
      applied.has(name),
    );
    if (presentAliases.length > 0) {
      console.log(
        `[prisma:staging] Recognized legacy aliases: ${presentAliases.join(", ")}`,
      );
    }
  }

  return pending.length === 0 && failures.length === 0 && unexpectedDatabaseOnly.length === 0;
}

function runPrisma(prismaArgs) {
  if (!existsSync(prismaCliPath)) {
    fail("Prisma CLI is not installed. Run npm ci before migrating staging.");
  }
  const result = spawnSync(process.execPath, [prismaCliPath, ...prismaArgs], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) fail(`Unable to start Prisma CLI (${result.error.code ?? "UNKNOWN"}).`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function failWithDatabaseError(message, error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
  fail(`${message} (${code}).`);
}

function fail(message) {
  console.error(`[prisma:staging] ${message}`);
  process.exit(1);
}
