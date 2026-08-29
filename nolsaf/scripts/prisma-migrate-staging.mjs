import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import prismaPackage from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  assertRecoverableUserTableNames,
  missingUserRegistrationColumns,
  missingUserRegistrationIndexes,
  USER_REGISTRATION_COLUMNS,
  USER_REGISTRATION_LIFECYCLE_MIGRATION,
} from "./lib/user-registration-lifecycle-recovery.mjs";

const { PrismaClient } = prismaPackage;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..");
const schemaPath = join(repoRoot, "prisma", "schema.prisma");
const migrationsPath = join(repoRoot, "prisma", "migrations");
const prismaCliPath = join(repoRoot, "node_modules", "prisma", "build", "index.js");
const migrationChecksumManifest = JSON.parse(
  readFileSync(join(repoRoot, "prisma", "migration-checksums.json"), "utf8"),
);

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
const propertyShareAttribution = "20260823090000_add_property_share_attribution";
const trustVerification = "20260823140000_add_trust_verification";
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

// This committed migration used the Prisma model name `User` after the model
// had been mapped to the exact lowercase physical table `user`. Windows MySQL
// did not expose the mismatch, while Linux-hosted Aiven correctly failed its
// first statement. Establish and verify the intended physical state before
// resolving only that active failed migration as applied.
if (activeFailures.has(USER_REGISTRATION_LIFECYCLE_MIGRATION)) {
  assertLocalMigrationChecksum(USER_REGISTRATION_LIFECYCLE_MIGRATION);
  await recoverUserRegistrationLifecycle();
  repairs.push(["--applied", USER_REGISTRATION_LIFECYCLE_MIGRATION]);
}

// These two migrations were authored after the same physical tables had been
// normalized to lowercase, but their foreign keys still referenced the old
// Prisma model table names. Reconcile either a pending or partially committed
// attempt before Prisma reaches it, then record the migration only after every
// table, index, and relationship has been verified.
if (!appliedNames.has(propertyShareAttribution)) {
  assertLocalMigrationChecksum(propertyShareAttribution);
  await recoverPropertyShareAttribution();
  repairs.push(["--applied", propertyShareAttribution]);
}
if (!appliedNames.has(trustVerification)) {
  assertLocalMigrationChecksum(trustVerification);
  await recoverTrustVerification();
  repairs.push(["--applied", trustVerification]);
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

async function recoverUserRegistrationLifecycle() {
  const client = await getPrisma();
  const tableRows = await client.$queryRawUnsafe(
    `SELECT table_name AS table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND (BINARY table_name = BINARY 'user' OR BINARY table_name = BINARY 'User')`,
  );
  try {
    assertRecoverableUserTableNames(tableRows.map((row) => row.table_name));
  } catch (error) {
    await disconnect();
    fail(
      `Cannot recover ${USER_REGISTRATION_LIFECYCLE_MIGRATION}: ${error.message}.`,
    );
  }

  let columnRows = await readUserRegistrationColumns();
  for (const column of missingUserRegistrationColumns(
    columnRows.map((row) => row.column_name),
  )) {
    console.log(
      `[prisma:staging] Adding missing user.${column.name} for ${USER_REGISTRATION_LIFECYCLE_MIGRATION}.`,
    );
    await client.$executeRawUnsafe(
      `ALTER TABLE \`user\` ADD COLUMN \`${column.name}\` ${column.definition}`,
    );
  }

  columnRows = await readUserRegistrationColumns();
  assertUserRegistrationColumnDefinitions(columnRows);

  console.log(
    "[prisma:staging] Applying verified legacy registration backfill on user.",
  );
  await client.$executeRawUnsafe(`
    UPDATE \`user\`
    SET
      \`registrationSource\` = 'LEGACY',
      \`registrationStatus\` = CASE
        WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
        THEN 'COMPLETE'
        ELSE 'INCOMPLETE'
      END,
      \`profileCompletedAt\` = CASE
        WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
        THEN COALESCE(\`updatedAt\`, \`createdAt\`)
        ELSE NULL
      END
  `);

  const invalidRows = await client.$queryRawUnsafe(`
    SELECT COUNT(*) AS count
    FROM \`user\`
    WHERE \`registrationSource\` <> 'LEGACY'
       OR NOT (
         \`registrationStatus\` <=> CASE
           WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
             AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
             AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
           THEN 'COMPLETE'
           ELSE 'INCOMPLETE'
         END
       )
       OR NOT (
         \`profileCompletedAt\` <=> CASE
           WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
             AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
             AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
           THEN COALESCE(\`updatedAt\`, \`createdAt\`)
           ELSE NULL
         END
       )
  `);
  if (Number(invalidRows[0]?.count ?? 0) !== 0) {
    await disconnect();
    fail(
      `Cannot recover ${USER_REGISTRATION_LIFECYCLE_MIGRATION}: registration backfill verification failed.`,
    );
  }

  let existingIndexes = await readUserRegistrationIndexes();
  for (const index of missingUserRegistrationIndexes(existingIndexes)) {
    console.log(
      `[prisma:staging] Creating missing index ${index.name} for ${USER_REGISTRATION_LIFECYCLE_MIGRATION}.`,
    );
    const columnsSql = index.columns.map((column) => `\`${column}\``).join(", ");
    await client.$executeRawUnsafe(
      `CREATE INDEX \`${index.name}\` ON \`user\` (${columnsSql})`,
    );
  }

  existingIndexes = await readUserRegistrationIndexes();
  const stillMissing = missingUserRegistrationIndexes(existingIndexes);
  if (stillMissing.length > 0) {
    await disconnect();
    fail(
      `Cannot recover ${USER_REGISTRATION_LIFECYCLE_MIGRATION}: indexes ${stillMissing
        .map((index) => index.name)
        .join(", ")} are still missing.`,
    );
  }
  console.log(
    `[prisma:staging] Verified physical state for ${USER_REGISTRATION_LIFECYCLE_MIGRATION}.`,
  );
}

async function readUserRegistrationColumns() {
  const client = await getPrisma();
  const names = USER_REGISTRATION_COLUMNS.map((column) => column.name);
  const placeholders = names.map(() => "?").join(", ");
  return client.$queryRawUnsafe(
    `SELECT column_name AS column_name,
            LOWER(column_type) AS column_type,
            is_nullable AS is_nullable,
            column_default AS column_default
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND BINARY table_name = BINARY 'user'
       AND column_name IN (${placeholders})`,
    ...names,
  );
}

function assertUserRegistrationColumnDefinitions(columnRows) {
  const byName = new Map(columnRows.map((row) => [row.column_name, row]));
  for (const expected of USER_REGISTRATION_COLUMNS) {
    const actual = byName.get(expected.name);
    const nullable = actual?.is_nullable === "YES";
    const defaultValue = actual?.column_default ?? null;
    if (
      !actual ||
      actual.column_type !== expected.type ||
      nullable !== expected.nullable ||
      defaultValue !== expected.defaultValue
    ) {
      fail(
        `Cannot recover ${USER_REGISTRATION_LIFECYCLE_MIGRATION}: user.${expected.name} has an unexpected definition.`,
      );
    }
  }
}

async function readUserRegistrationIndexes() {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT index_name AS index_name,
            column_name AS column_name,
            seq_in_index AS seq_in_index,
            non_unique AS non_unique
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND BINARY table_name = BINARY 'user'
       AND index_name <> 'PRIMARY'
     ORDER BY index_name, seq_in_index`,
  );
  const indexes = new Map();
  for (const row of rows) {
    const index = indexes.get(row.index_name) ?? {
      name: row.index_name,
      unique: Number(row.non_unique) === 0,
      columns: [],
    };
    index.columns.push(row.column_name);
    indexes.set(row.index_name, index);
  }
  return [...indexes.values()];
}

async function recoverPropertyShareAttribution() {
  await assertExactTableExists("user");
  await assertExactTableExists("property");
  await assertExactTableExists("booking");
  const client = await getPrisma();
  if (!(await exactTableExists("property_share"))) {
    console.log(`[prisma:staging] Creating property_share for ${propertyShareAttribution}.`);
    await client.$executeRawUnsafe(`
      CREATE TABLE \`property_share\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`token\` VARCHAR(24) NOT NULL,
        \`sharerId\` INTEGER NOT NULL,
        \`propertyId\` INTEGER NOT NULL,
        \`channel\` VARCHAR(20) NULL,
        \`openCount\` INTEGER NOT NULL DEFAULT 0,
        \`firstOpenedAt\` DATETIME(3) NULL,
        \`lastOpenedAt\` DATETIME(3) NULL,
        \`registeredUserId\` INTEGER NULL,
        \`registeredAt\` DATETIME(3) NULL,
        \`bookingId\` INTEGER NULL,
        \`convertedAt\` DATETIME(3) NULL,
        \`revokedAt\` DATETIME(3) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  await assertColumnsExist("property_share", [
    "id", "token", "sharerId", "propertyId", "channel", "openCount",
    "firstOpenedAt", "lastOpenedAt", "registeredUserId", "registeredAt",
    "bookingId", "convertedAt", "revokedAt", "createdAt", "updatedAt",
  ]);
  await ensureIndexDefinition("property_share", "property_share_token_key", ["token"], true);
  await ensureIndexDefinition(
    "property_share",
    "property_share_sharerId_createdAt_idx",
    ["sharerId", "createdAt"],
  );
  await ensureIndexDefinition("property_share", "property_share_propertyId_idx", ["propertyId"]);
  await ensureIndexDefinition(
    "property_share",
    "property_share_registeredUserId_idx",
    ["registeredUserId"],
  );
  await ensureIndexDefinition("property_share", "property_share_bookingId_idx", ["bookingId"]);
  await ensureIndexDefinition("property_share", "property_share_createdAt_idx", ["createdAt"]);
  await ensureForeignKey(
    "property_share", "sharerId", "property_share_sharerId_fkey", "user", "id", "CASCADE",
  );
  await ensureForeignKey(
    "property_share", "propertyId", "property_share_propertyId_fkey", "property", "id", "CASCADE",
  );
  await ensureForeignKey(
    "property_share", "registeredUserId", "property_share_registeredUserId_fkey", "user", "id", "SET NULL",
  );
  await ensureForeignKey(
    "property_share", "bookingId", "property_share_bookingId_fkey", "booking", "id", "SET NULL",
  );
  console.log(`[prisma:staging] Verified physical state for ${propertyShareAttribution}.`);
}

async function recoverTrustVerification() {
  await assertExactTableExists("user");
  const client = await getPrisma();
  if (!(await exactTableExists("company_verifications"))) {
    console.log(`[prisma:staging] Creating company_verifications for ${trustVerification}.`);
    await client.$executeRawUnsafe(`
      CREATE TABLE \`company_verifications\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`key\` VARCHAR(80) NOT NULL,
        \`category\` VARCHAR(40) NOT NULL,
        \`displayName\` VARCHAR(160) NOT NULL,
        \`authorityName\` VARCHAR(160) NULL,
        \`authorityDomain\` VARCHAR(160) NULL,
        \`jurisdiction\` VARCHAR(120) NULL,
        \`registrationNumber\` VARCHAR(120) NULL,
        \`registrationNumberNormalized\` VARCHAR(120) NULL,
        \`publicSummary\` TEXT NULL,
        \`status\` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        \`visibility\` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
        \`externalVerificationUrl\` VARCHAR(500) NULL,
        \`issuedAt\` DATETIME(3) NULL,
        \`expiresAt\` DATETIME(3) NULL,
        \`lastCheckedAt\` DATETIME(3) NULL,
        \`evidenceApprovedAt\` DATETIME(3) NULL,
        \`evidenceApprovedById\` INTEGER NULL,
        \`evidenceNote\` VARCHAR(1000) NULL,
        \`publishedAt\` DATETIME(3) NULL,
        \`publishedById\` INTEGER NULL,
        \`sortOrder\` INTEGER NOT NULL DEFAULT 0,
        \`createdById\` INTEGER NULL,
        \`updatedById\` INTEGER NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL,
        \`archivedAt\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  if (!(await exactTableExists("official_company_channels"))) {
    console.log(`[prisma:staging] Creating official_company_channels for ${trustVerification}.`);
    await client.$executeRawUnsafe(`
      CREATE TABLE \`official_company_channels\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`channelType\` VARCHAR(30) NOT NULL,
        \`label\` VARCHAR(160) NOT NULL,
        \`value\` VARCHAR(500) NOT NULL,
        \`href\` VARCHAR(500) NULL,
        \`notes\` VARCHAR(500) NULL,
        \`confirmedAt\` DATETIME(3) NULL,
        \`confirmedById\` INTEGER NULL,
        \`visibility\` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
        \`publishedAt\` DATETIME(3) NULL,
        \`sortOrder\` INTEGER NOT NULL DEFAULT 0,
        \`createdById\` INTEGER NULL,
        \`updatedById\` INTEGER NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL,
        \`archivedAt\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  await assertColumnsExist("company_verifications", [
    "id", "key", "category", "displayName", "authorityName", "authorityDomain",
    "jurisdiction", "registrationNumber", "registrationNumberNormalized",
    "publicSummary", "status", "visibility", "externalVerificationUrl", "issuedAt",
    "expiresAt", "lastCheckedAt", "evidenceApprovedAt", "evidenceApprovedById",
    "evidenceNote", "publishedAt", "publishedById", "sortOrder", "createdById",
    "updatedById", "createdAt", "updatedAt", "archivedAt",
  ]);
  await assertColumnsExist("official_company_channels", [
    "id", "channelType", "label", "value", "href", "notes", "confirmedAt",
    "confirmedById", "visibility", "publishedAt", "sortOrder", "createdById",
    "updatedById", "createdAt", "updatedAt", "archivedAt",
  ]);
  await ensureIndexDefinition("company_verifications", "company_verifications_key_key", ["key"], true);
  await ensureIndexDefinition(
    "company_verifications",
    "company_verifications_visibility_publishedAt_sortOrder_idx",
    ["visibility", "publishedAt", "sortOrder"],
  );
  await ensureIndexDefinition(
    "company_verifications",
    "company_verifications_status_expiresAt_idx",
    ["status", "expiresAt"],
  );
  await ensureIndexDefinition(
    "company_verifications",
    "company_verifications_category_sortOrder_idx",
    ["category", "sortOrder"],
  );
  await ensureIndexDefinition(
    "company_verifications",
    "company_verifications_registrationNumberNormalized_idx",
    ["registrationNumberNormalized"],
  );
  await ensureIndexDefinition(
    "official_company_channels",
    "official_company_channels_visibility_publishedAt_sortOrder_idx",
    ["visibility", "publishedAt", "sortOrder"],
  );
  await ensureIndexDefinition(
    "official_company_channels",
    "official_company_channels_channelType_sortOrder_idx",
    ["channelType", "sortOrder"],
  );
  await ensureForeignKey(
    "company_verifications", "evidenceApprovedById",
    "company_verifications_evidenceApprovedById_fkey", "user", "id", "SET NULL",
  );
  await ensureForeignKey(
    "company_verifications", "publishedById",
    "company_verifications_publishedById_fkey", "user", "id", "SET NULL",
  );
  await ensureForeignKey(
    "official_company_channels", "confirmedById",
    "official_company_channels_confirmedById_fkey", "user", "id", "SET NULL",
  );
  console.log(`[prisma:staging] Verified physical state for ${trustVerification}.`);
}

async function exactTableExists(tableName) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND BINARY table_name = BINARY ?`,
    tableName,
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function assertExactTableExists(tableName) {
  if (await exactTableExists(tableName)) return;
  await disconnect();
  fail(`Cannot recover case-sensitive migration: exact table ${tableName} is missing.`);
}

function assertLocalMigrationChecksum(migrationName) {
  const migrationPath = join(migrationsPath, migrationName, "migration.sql");
  if (!existsSync(migrationPath)) {
    fail(`Cannot recover ${migrationName}: local migration SQL is missing.`);
  }
  const actual = createHash("sha256").update(readFileSync(migrationPath)).digest("hex");
  const expected = migrationChecksumManifest.migrations?.[migrationName];
  if (!expected || actual !== expected) {
    fail(`Cannot recover ${migrationName}: local migration checksum is not approved.`);
  }
}

async function ensureIndexDefinition(tableName, indexName, columnNames, unique = false) {
  const client = await getPrisma();
  const rows = await client.$queryRawUnsafe(
    `SELECT column_name AS column_name,
            seq_in_index AS seq_in_index,
            non_unique AS non_unique
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND BINARY table_name = BINARY ?
       AND index_name = ?
     ORDER BY seq_in_index`,
    tableName,
    indexName,
  );
  if (rows.length > 0) {
    const actualColumns = rows.map((row) => row.column_name);
    const actualUnique = Number(rows[0].non_unique) === 0;
    if (
      actualUnique !== unique ||
      actualColumns.length !== columnNames.length ||
      actualColumns.some((column, index) => column !== columnNames[index])
    ) {
      fail(`Cannot recover case-sensitive migration: index ${indexName} has an unexpected definition.`);
    }
    return;
  }
  const columnsSql = columnNames.map((column) => `\`${column}\``).join(", ");
  console.log(`[prisma:staging] Creating missing index ${indexName}.`);
  await client.$executeRawUnsafe(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`,
  );
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
  const rawDetail =
    error && typeof error === "object" && "meta" in error && error.meta?.message
      ? String(error.meta.message)
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  const secrets = [databaseUrl, decodeURIComponent(parsedDatabaseUrl.password)].filter(
    Boolean,
  );
  const redactedDetail = secrets
    .reduce((detail, secret) => detail.replaceAll(secret, "[REDACTED]"), rawDetail)
    .replace(/\s+/g, " ")
    .trim();
  fail(
    `${message} (${code})${redactedDetail ? `: ${redactedDetail}` : "."}`,
  );
}

function fail(message) {
  console.error(`[prisma:staging] ${message}`);
  process.exit(1);
}
