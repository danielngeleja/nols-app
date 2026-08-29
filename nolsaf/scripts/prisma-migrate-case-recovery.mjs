import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import prismaPackage from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import {
  assertRecoverableUserTableNames,
  assertRecoveryTargetHost,
  CASE_SENSITIVE_RECOVERY_MIGRATIONS,
  CASE_SENSITIVE_RECOVERY_PREREQUISITE,
  classifyRecoveryMigration,
  missingUserRegistrationColumns,
  missingUserRegistrationIndexes,
  recoveryTargetFingerprint,
  USER_REGISTRATION_COLUMNS,
  USER_REGISTRATION_INDEXES,
} from "./lib/user-registration-lifecycle-recovery.mjs";

const { PrismaClient } = prismaPackage;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsPath = join(root, "prisma", "migrations");
const manifest = JSON.parse(
  readFileSync(join(root, "prisma", "migration-checksums.json"), "utf8"),
);
const prismaCli = process.env.MIGRATION_RECOVERY_PRISMA_CLI
  ? resolve(process.env.MIGRATION_RECOVERY_PRISMA_CLI)
  : join(root, "node_modules", "prisma", "build", "index.js");

const targetArgument = process.argv.find((value) => value.startsWith("--target="));
const target = targetArgument?.slice("--target=".length);
const modeArgument = process.argv.find((value) => value.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) ?? "verify";
const configArgument = process.argv.find((value) => value.startsWith("--config="));
const prismaConfig = configArgument?.slice("--config=".length);

if (!new Set(["clone", "production"]).has(target)) {
  fail("Use --target=clone or --target=production.");
}
if (!new Set(["verify", "repair"]).has(mode)) {
  fail("Use --mode=verify or --mode=repair.");
}
if (mode === "repair" && !prismaConfig) {
  fail("Repair mode requires --config=<exact release Prisma config>.");
}

const urlVariable =
  target === "clone"
    ? "PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL"
    : "MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL";
const databaseUrl = process.env[urlVariable];
if (!databaseUrl) {
  fail(`${urlVariable} is required; DATABASE_URL is intentionally ignored.`);
}

let parsedUrl;
let fingerprint;
try {
  parsedUrl = new URL(databaseUrl);
  assertRecoveryTargetHost(target, parsedUrl.hostname);
  fingerprint = recoveryTargetFingerprint(target, databaseUrl);
} catch (error) {
  fail(`Invalid recovery target: ${error.message}.`);
}

if (process.env.MIGRATION_RECOVERY_ACKNOWLEDGE !== fingerprint) {
  fail(
    `Refusing database access. Set MIGRATION_RECOVERY_ACKNOWLEDGE exactly to ${fingerprint}.`,
  );
}
if (
  mode === "repair" &&
  process.env.MIGRATION_RECOVERY_CONFIRM !==
    `repair:${target}:${CASE_SENSITIVE_RECOVERY_MIGRATIONS.join(",")}`
) {
  fail("Repair confirmation is missing or does not name the exact recovery set.");
}

for (const migrationName of CASE_SENSITIVE_RECOVERY_MIGRATIONS) {
  assertLocalMigrationChecksum(migrationName);
}
if (mode === "repair" && !existsSync(prismaCli)) {
  fail(`Prisma CLI not found at ${prismaCli}.`);
}
if (mode === "repair" && !existsSync(resolve(prismaConfig))) {
  fail(`Prisma config not found at ${resolve(prismaConfig)}.`);
}

console.log(`[case-recovery] ${mode} target ${fingerprint}`);
const sslCertificatePath =
  parsedUrl.searchParams.get("sslcert") ?? parsedUrl.searchParams.get("ssl-ca");
let ssl;
if (sslCertificatePath) {
  if (!existsSync(sslCertificatePath)) fail("Configured TLS CA certificate is missing.");
  ssl = { ca: readFileSync(sslCertificatePath), rejectUnauthorized: true };
} else if (
  parsedUrl.searchParams.has("ssl-mode") ||
  parsedUrl.searchParams.has("sslmode") ||
  parsedUrl.searchParams.has("sslaccept")
) {
  fail("TLS was requested without an explicit CA certificate.");
} else {
  fail("Recovery requires strict TLS with sslcert=<CA path> in the target URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 3306,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ""),
    ssl,
    connectTimeout: 30_000,
    socketTimeout: 60_000,
    connectionLimit: 1,
  }),
});

try {
  await assertDatabaseIdentity();
  let migrationRows = await readMigrationRows();
  const prerequisiteState = classifyRecoveryMigration(
    migrationRows,
    CASE_SENSITIVE_RECOVERY_PREREQUISITE,
  );
  if (prerequisiteState !== "applied") {
    fail(
      `Prerequisite ${CASE_SENSITIVE_RECOVERY_PREREQUISITE} is ${prerequisiteState}; run the exact release migrations up to that point first.`,
    );
  }

  const initialStates = Object.fromEntries(
    CASE_SENSITIVE_RECOVERY_MIGRATIONS.map((name) => [
      name,
      classifyRecoveryMigration(migrationRows, name),
    ]),
  );
  console.log(`[case-recovery] Initial states ${JSON.stringify(initialStates)}`);

  if (mode === "verify") {
    await verifyAppliedRecoverySet(migrationRows);
    console.log("[case-recovery] Recovery history and physical invariants are verified.");
    process.exitCode = 0;
  } else {
    const userMigration = CASE_SENSITIVE_RECOVERY_MIGRATIONS[0];
    if (initialStates[userMigration] === "pending") {
      const appliedLaterMigrations = readdirSync(migrationsPath)
        .filter((name) => name > userMigration)
        .filter((name) => classifyRecoveryMigration(migrationRows, name) === "applied");
      if (appliedLaterMigrations.length > 0) {
        fail(
          `${userMigration} is pending while later migrations are applied: ${appliedLaterMigrations.join(", ")}.`,
        );
      }
      console.log(
        `[case-recovery] ${userMigration} is pending after its verified prerequisite; applying its case-correct physical equivalent.`,
      );
      if ((await readUserRegistrationColumns()).length !== 0) {
        fail(`${userMigration} is pending but one or more lifecycle columns already exist.`);
      }
    }

    if (initialStates[userMigration] !== "applied") {
      await recoverUserRegistrationLifecycle();
      await resolveApplied(userMigration);
    } else {
      await verifyUserRegistrationLifecycle();
    }

    const propertyShareMigration = CASE_SENSITIVE_RECOVERY_MIGRATIONS[1];
    if (initialStates[propertyShareMigration] !== "applied") {
      if (
        initialStates[propertyShareMigration] === "pending" &&
        (await exactTableExists("property_share"))
      ) {
        fail(`${propertyShareMigration} is pending but property_share already exists.`);
      }
      await recoverPropertyShareAttribution();
      await resolveApplied(propertyShareMigration);
    } else {
      await verifyPropertyShareAttribution();
    }

    const trustMigration = CASE_SENSITIVE_RECOVERY_MIGRATIONS[2];
    if (initialStates[trustMigration] !== "applied") {
      if (
        initialStates[trustMigration] === "pending" &&
        ((await exactTableExists("company_verifications")) ||
          (await exactTableExists("official_company_channels")))
      ) {
        fail(`${trustMigration} is pending but one or more target tables already exist.`);
      }
      await recoverTrustVerification();
      await resolveApplied(trustMigration);
    } else {
      await verifyTrustVerification();
    }

    runPrisma(["migrate", "deploy"]);
    runPrisma(["migrate", "status"]);
    migrationRows = await readMigrationRows();
    await verifyAppliedRecoverySet(migrationRows);
    console.log("[case-recovery] Recovery, remaining deploy, and final verification passed.");
  }
} catch (error) {
  failWithDatabaseError(error);
} finally {
  await prisma.$disconnect();
}

async function assertDatabaseIdentity() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT DATABASE() AS database_name, @@lower_case_table_names AS lower_case_table_names",
  );
  const expectedDatabase = parsedUrl.pathname.replace(/^\//, "");
  if (rows[0]?.database_name !== expectedDatabase) {
    throw new Error("connected database name does not match the acknowledged URL");
  }
  if (Number(rows[0]?.lower_case_table_names) !== 0) {
    throw new Error("recovery is only valid for case-sensitive lower_case_table_names=0");
  }
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND (BINARY table_name = BINARY 'user' OR BINARY table_name = BINARY 'User')
  `);
  assertRecoverableUserTableNames(tables.map((row) => row.table_name));
}

async function readMigrationRows() {
  return prisma.$queryRawUnsafe(`
    SELECT migration_name, checksum, started_at, finished_at, rolled_back_at
    FROM _prisma_migrations
    ORDER BY started_at, migration_name
  `);
}

async function resolveApplied(migrationName) {
  console.log(`[case-recovery] Resolving independently verified migration ${migrationName}.`);
  runPrisma(["migrate", "resolve", "--applied", migrationName]);
}

async function recoverUserRegistrationLifecycle() {
  let columns = await readUserRegistrationColumns();
  for (const column of missingUserRegistrationColumns(columns.map((row) => row.column_name))) {
    console.log(`[case-recovery] Adding user.${column.name}.`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`user\` ADD COLUMN \`${column.name}\` ${column.definition}`,
    );
  }
  columns = await readUserRegistrationColumns();
  assertUserRegistrationColumnDefinitions(columns);
  const before = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM `user`");
  console.log(`[case-recovery] Backfilling ${Number(before[0]?.count ?? 0)} legacy user rows.`);
  await prisma.$executeRawUnsafe(`
    UPDATE \`user\`
    SET
      \`registrationSource\` = 'LEGACY',
      \`registrationStatus\` = CASE
        WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
        THEN 'COMPLETE' ELSE 'INCOMPLETE' END,
      \`profileCompletedAt\` = CASE
        WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
        THEN COALESCE(\`updatedAt\`, \`createdAt\`) ELSE NULL END
  `);
  let indexes = await readIndexes("user");
  for (const index of missingUserRegistrationIndexes(indexes)) {
    await ensureIndex("user", index.name, index.columns, false);
  }
  await verifyUserRegistrationLifecycle();
}

async function verifyUserRegistrationLifecycle() {
  assertUserRegistrationColumnDefinitions(await readUserRegistrationColumns());
  const invalid = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS count FROM \`user\`
    WHERE \`registrationSource\` <> 'LEGACY'
       OR NOT (\`registrationStatus\` <=> CASE
         WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
           AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
           AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
         THEN 'COMPLETE' ELSE 'INCOMPLETE' END)
       OR NOT (\`profileCompletedAt\` <=> CASE
         WHEN COALESCE(NULLIF(TRIM(\`name\`), ''), NULLIF(TRIM(\`fullName\`), '')) IS NOT NULL
           AND NULLIF(TRIM(COALESCE(\`email\`, '')), '') IS NOT NULL
           AND NULLIF(TRIM(COALESCE(\`phone\`, '')), '') IS NOT NULL
         THEN COALESCE(\`updatedAt\`, \`createdAt\`) ELSE NULL END)
  `);
  if (Number(invalid[0]?.count ?? 0) !== 0) {
    throw new Error("user registration lifecycle backfill verification failed");
  }
  const missing = missingUserRegistrationIndexes(await readIndexes("user"));
  if (missing.length > 0) throw new Error("user registration lifecycle indexes are missing");
  for (const index of USER_REGISTRATION_INDEXES) {
    await assertIndexShapeExists("user", index.columns, false);
  }
}

async function readUserRegistrationColumns() {
  return prisma.$queryRawUnsafe(`
    SELECT column_name, LOWER(column_type) AS column_type,
           is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND BINARY table_name = BINARY 'user'
      AND column_name IN ('registrationStatus', 'registrationSource', 'profileCompletedAt')
  `);
}

function assertUserRegistrationColumnDefinitions(rows) {
  const byName = new Map(rows.map((row) => [row.column_name, row]));
  for (const expected of USER_REGISTRATION_COLUMNS) {
    const actual = byName.get(expected.name);
    if (
      !actual || actual.column_type !== expected.type ||
      (actual.is_nullable === "YES") !== expected.nullable ||
      (actual.column_default ?? null) !== expected.defaultValue
    ) {
      throw new Error(`user.${expected.name} has an unexpected definition`);
    }
  }
}

async function recoverPropertyShareAttribution() {
  await assertExactTables(["user", "property", "booking"]);
  if (!(await exactTableExists("property_share"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`property_share\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT, \`token\` VARCHAR(24) NOT NULL,
        \`sharerId\` INTEGER NOT NULL, \`propertyId\` INTEGER NOT NULL,
        \`channel\` VARCHAR(20) NULL, \`openCount\` INTEGER NOT NULL DEFAULT 0,
        \`firstOpenedAt\` DATETIME(3) NULL, \`lastOpenedAt\` DATETIME(3) NULL,
        \`registeredUserId\` INTEGER NULL, \`registeredAt\` DATETIME(3) NULL,
        \`bookingId\` INTEGER NULL, \`convertedAt\` DATETIME(3) NULL,
        \`revokedAt\` DATETIME(3) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL, PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  await ensureIndex("property_share", "property_share_token_key", ["token"], true);
  await ensureIndex("property_share", "property_share_sharerId_createdAt_idx", ["sharerId", "createdAt"]);
  await ensureIndex("property_share", "property_share_propertyId_idx", ["propertyId"]);
  await ensureIndex("property_share", "property_share_registeredUserId_idx", ["registeredUserId"]);
  await ensureIndex("property_share", "property_share_bookingId_idx", ["bookingId"]);
  await ensureIndex("property_share", "property_share_createdAt_idx", ["createdAt"]);
  await ensureForeignKey("property_share", "sharerId", "property_share_sharerId_fkey", "user", "id", "CASCADE");
  await ensureForeignKey("property_share", "propertyId", "property_share_propertyId_fkey", "property", "id", "CASCADE");
  await ensureForeignKey("property_share", "registeredUserId", "property_share_registeredUserId_fkey", "user", "id", "SET NULL");
  await ensureForeignKey("property_share", "bookingId", "property_share_bookingId_fkey", "booking", "id", "SET NULL");
  await verifyPropertyShareAttribution();
}

async function verifyPropertyShareAttribution() {
  await assertExactTables(["property_share"]);
  await assertColumns("property_share", ["id", "token", "sharerId", "propertyId", "channel", "openCount", "firstOpenedAt", "lastOpenedAt", "registeredUserId", "registeredAt", "bookingId", "convertedAt", "revokedAt", "createdAt", "updatedAt"]);
  await assertIndexShapeExists("property_share", ["token"], true);
  await assertIndexShapeExists("property_share", ["sharerId", "createdAt"], false);
  await assertIndexShapeExists("property_share", ["propertyId"], false);
  await assertIndexShapeExists("property_share", ["registeredUserId"], false);
  await assertIndexShapeExists("property_share", ["bookingId"], false);
  await assertIndexShapeExists("property_share", ["createdAt"], false);
  await assertForeignKey("property_share", "sharerId", "user", "id", "CASCADE");
  await assertForeignKey("property_share", "propertyId", "property", "id", "CASCADE");
  await assertForeignKey("property_share", "registeredUserId", "user", "id", "SET NULL");
  await assertForeignKey("property_share", "bookingId", "booking", "id", "SET NULL");
}

async function recoverTrustVerification() {
  await assertExactTables(["user"]);
  if (!(await exactTableExists("company_verifications"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`company_verifications\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT, \`key\` VARCHAR(80) NOT NULL,
        \`category\` VARCHAR(40) NOT NULL, \`displayName\` VARCHAR(160) NOT NULL,
        \`authorityName\` VARCHAR(160) NULL, \`authorityDomain\` VARCHAR(160) NULL,
        \`jurisdiction\` VARCHAR(120) NULL, \`registrationNumber\` VARCHAR(120) NULL,
        \`registrationNumberNormalized\` VARCHAR(120) NULL, \`publicSummary\` TEXT NULL,
        \`status\` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        \`visibility\` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
        \`externalVerificationUrl\` VARCHAR(500) NULL, \`issuedAt\` DATETIME(3) NULL,
        \`expiresAt\` DATETIME(3) NULL, \`lastCheckedAt\` DATETIME(3) NULL,
        \`evidenceApprovedAt\` DATETIME(3) NULL, \`evidenceApprovedById\` INTEGER NULL,
        \`evidenceNote\` VARCHAR(1000) NULL, \`publishedAt\` DATETIME(3) NULL,
        \`publishedById\` INTEGER NULL, \`sortOrder\` INTEGER NOT NULL DEFAULT 0,
        \`createdById\` INTEGER NULL, \`updatedById\` INTEGER NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL, \`archivedAt\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  if (!(await exactTableExists("official_company_channels"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`official_company_channels\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT, \`channelType\` VARCHAR(30) NOT NULL,
        \`label\` VARCHAR(160) NOT NULL, \`value\` VARCHAR(500) NOT NULL,
        \`href\` VARCHAR(500) NULL, \`notes\` VARCHAR(500) NULL,
        \`confirmedAt\` DATETIME(3) NULL, \`confirmedById\` INTEGER NULL,
        \`visibility\` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
        \`publishedAt\` DATETIME(3) NULL, \`sortOrder\` INTEGER NOT NULL DEFAULT 0,
        \`createdById\` INTEGER NULL, \`updatedById\` INTEGER NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL, \`archivedAt\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  await ensureIndex("company_verifications", "company_verifications_key_key", ["key"], true);
  await ensureIndex("company_verifications", "company_verifications_visibility_publishedAt_sortOrder_idx", ["visibility", "publishedAt", "sortOrder"]);
  await ensureIndex("company_verifications", "company_verifications_status_expiresAt_idx", ["status", "expiresAt"]);
  await ensureIndex("company_verifications", "company_verifications_category_sortOrder_idx", ["category", "sortOrder"]);
  await ensureIndex("company_verifications", "company_verifications_registrationNumberNormalized_idx", ["registrationNumberNormalized"]);
  await ensureIndex("official_company_channels", "official_company_channels_visibility_publishedAt_sortOrder_idx", ["visibility", "publishedAt", "sortOrder"]);
  await ensureIndex("official_company_channels", "official_company_channels_channelType_sortOrder_idx", ["channelType", "sortOrder"]);
  await ensureForeignKey("company_verifications", "evidenceApprovedById", "company_verifications_evidenceApprovedById_fkey", "user", "id", "SET NULL");
  await ensureForeignKey("company_verifications", "publishedById", "company_verifications_publishedById_fkey", "user", "id", "SET NULL");
  await ensureForeignKey("official_company_channels", "confirmedById", "official_company_channels_confirmedById_fkey", "user", "id", "SET NULL");
  await verifyTrustVerification();
}

async function verifyTrustVerification() {
  await assertExactTables(["company_verifications", "official_company_channels"]);
  await assertColumns("company_verifications", ["id", "key", "category", "displayName", "authorityName", "authorityDomain", "jurisdiction", "registrationNumber", "registrationNumberNormalized", "publicSummary", "status", "visibility", "externalVerificationUrl", "issuedAt", "expiresAt", "lastCheckedAt", "evidenceApprovedAt", "evidenceApprovedById", "evidenceNote", "publishedAt", "publishedById", "sortOrder", "createdById", "updatedById", "createdAt", "updatedAt", "archivedAt"]);
  await assertColumns("official_company_channels", ["id", "channelType", "label", "value", "href", "notes", "confirmedAt", "confirmedById", "visibility", "publishedAt", "sortOrder", "createdById", "updatedById", "createdAt", "updatedAt", "archivedAt"]);
  await assertIndexShapeExists("company_verifications", ["key"], true);
  await assertIndexShapeExists("company_verifications", ["visibility", "publishedAt", "sortOrder"], false);
  await assertIndexShapeExists("company_verifications", ["status", "expiresAt"], false);
  await assertIndexShapeExists("company_verifications", ["category", "sortOrder"], false);
  await assertIndexShapeExists("company_verifications", ["registrationNumberNormalized"], false);
  await assertIndexShapeExists("official_company_channels", ["visibility", "publishedAt", "sortOrder"], false);
  await assertIndexShapeExists("official_company_channels", ["channelType", "sortOrder"], false);
  await assertForeignKey("company_verifications", "evidenceApprovedById", "user", "id", "SET NULL");
  await assertForeignKey("company_verifications", "publishedById", "user", "id", "SET NULL");
  await assertForeignKey("official_company_channels", "confirmedById", "user", "id", "SET NULL");
}

async function verifyAppliedRecoverySet(rows) {
  for (const migrationName of CASE_SENSITIVE_RECOVERY_MIGRATIONS) {
    if (classifyRecoveryMigration(rows, migrationName) !== "applied") {
      throw new Error(`${migrationName} is not successfully applied`);
    }
    const row = rows.find(
      (candidate) =>
        candidate.migration_name === migrationName &&
        candidate.finished_at && !candidate.rolled_back_at,
    );
    if (row.checksum !== manifest.migrations[migrationName]) {
      throw new Error(`${migrationName} database checksum differs from the release manifest`);
    }
  }
  await verifyUserRegistrationLifecycle();
  await verifyPropertyShareAttribution();
  await verifyTrustVerification();
}

async function exactTableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND BINARY table_name = BINARY ?",
    tableName,
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function assertExactTables(tableNames) {
  for (const tableName of tableNames) {
    if (!(await exactTableExists(tableName))) throw new Error(`exact table ${tableName} is missing`);
  }
}

async function assertColumns(tableName, names) {
  const placeholders = names.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND BINARY table_name = BINARY ?
       AND column_name IN (${placeholders})`,
    tableName, ...names,
  );
  const found = new Set(rows.map((row) => row.column_name));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`${tableName} is missing columns ${missing.join(", ")}`);
}

async function readIndexes(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT index_name, column_name, seq_in_index, non_unique
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND BINARY table_name = BINARY ?
       AND index_name <> 'PRIMARY' ORDER BY index_name, seq_in_index`,
    tableName,
  );
  const indexes = new Map();
  for (const row of rows) {
    const index = indexes.get(row.index_name) ?? {
      name: row.index_name, unique: Number(row.non_unique) === 0, columns: [],
    };
    index.columns.push(row.column_name);
    indexes.set(row.index_name, index);
  }
  return [...indexes.values()];
}

async function ensureIndex(tableName, indexName, columns, unique = false) {
  const indexes = await readIndexes(tableName);
  const sameName = indexes.find((index) => index.name === indexName);
  if (sameName) {
    assertIndexDefinition(sameName, columns, unique, indexName);
    return;
  }
  if (indexes.some((index) => sameIndexShape(index, columns, unique))) return;
  const columnsSql = columns.map((column) => `\`${column}\``).join(", ");
  console.log(`[case-recovery] Creating index ${indexName}.`);
  await prisma.$executeRawUnsafe(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`,
  );
}

async function assertIndexShapeExists(tableName, columns, unique) {
  const indexes = await readIndexes(tableName);
  if (!indexes.some((index) => sameIndexShape(index, columns, unique))) {
    throw new Error(`${tableName} is missing index shape (${columns.join(", ")})`);
  }
}

function sameIndexShape(index, columns, unique) {
  return index.unique === unique && index.columns.length === columns.length &&
    index.columns.every((column, position) => column === columns[position]);
}

function assertIndexDefinition(index, columns, unique, name) {
  if (!sameIndexShape(index, columns, unique)) {
    throw new Error(`index ${name} exists with an unexpected definition`);
  }
}

async function ensureForeignKey(table, column, name, referencedTable, referencedColumn, onDelete) {
  const existing = await readForeignKey(table, column);
  if (existing) {
    assertForeignKeyDefinition(existing, referencedTable, referencedColumn, onDelete);
    return;
  }
  console.log(`[case-recovery] Creating foreign key ${name}.`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\`
     FOREIGN KEY (\`${column}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
     ON DELETE ${onDelete} ON UPDATE CASCADE`,
  );
}

async function assertForeignKey(table, column, referencedTable, referencedColumn, onDelete) {
  const existing = await readForeignKey(table, column);
  if (!existing) throw new Error(`${table}.${column} foreign key is missing`);
  assertForeignKeyDefinition(existing, referencedTable, referencedColumn, onDelete);
}

async function readForeignKey(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT k.referenced_table_name, k.referenced_column_name,
            r.delete_rule, r.update_rule
     FROM information_schema.key_column_usage k
     JOIN information_schema.referential_constraints r
       ON r.constraint_schema = k.constraint_schema
      AND r.table_name = k.table_name
      AND r.constraint_name = k.constraint_name
     WHERE k.table_schema = DATABASE() AND BINARY k.table_name = BINARY ?
       AND BINARY k.column_name = BINARY ? AND k.referenced_table_name IS NOT NULL`,
    table, column,
  );
  if (rows.length > 1) throw new Error(`${table}.${column} has multiple foreign keys`);
  return rows[0];
}

function assertForeignKeyDefinition(actual, table, column, onDelete) {
  if (
    actual.referenced_table_name !== table || actual.referenced_column_name !== column ||
    actual.delete_rule !== onDelete || actual.update_rule !== "CASCADE"
  ) {
    throw new Error(`foreign key to ${table}.${column} has unexpected semantics`);
  }
}

function assertLocalMigrationChecksum(migrationName) {
  const path = join(migrationsPath, migrationName, "migration.sql");
  if (!existsSync(path)) fail(`${migrationName} SQL is missing.`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (manifest.migrations?.[migrationName] !== actual) {
    fail(`${migrationName} checksum is not approved by the manifest.`);
  }
}

function runPrisma(args) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, ...args, `--config=${resolve(prismaConfig)}`],
    { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma ${args.join(" ")} failed`);
}

function failWithDatabaseError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const secrets = [databaseUrl, decodeURIComponent(parsedUrl.password)].filter(Boolean);
  const redacted = secrets.reduce((value, secret) => value.replaceAll(secret, "[REDACTED]"), raw);
  fail(redacted.replace(/\s+/g, " ").trim());
}

function fail(message) {
  console.error(`[case-recovery] ${message}`);
  process.exit(1);
}
