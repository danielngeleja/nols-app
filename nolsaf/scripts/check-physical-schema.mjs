import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prismaPackage from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const { PrismaClient } = prismaPackage;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "prisma", "schema.prisma");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const manifest = JSON.parse(
  readFileSync(join(root, "prisma", "migration-checksums.json"), "utf8"),
);
const allowedLegacyMigrationNames = new Set([
  "20251213210000_baseline",
  "20260106185415_add_performance_indexes",
]);
// Staging applied these exact historical SQL revisions before the files were
// edited in later commits. Three hashes match the original Git revisions. The
// property-verification hash is the successful case-corrected revision whose
// semantics were verified by physical diff plus property/orphan preflights.
// Keep this registry explicit: never rewrite _prisma_migrations to hide history.
const acceptedHistoricalMigrationHashes = new Map([
  [
    "20260629090000_add_property_verification",
    new Set(["ab34ab4b4773589b492179157d8ce993fbd24edae04cf3eecc84dd4c5da6032d"]),
  ],
  [
    "20260714130000_reconcile_legacy_database_drift",
    new Set(["e6087c4c25ac026b591ba4ba3002541c183f7b62dcd5556901efac127f2fe6b9"]),
  ],
  [
    "20260714195920",
    new Set(["5f4541d704a6fe6019966ff9416e93a43a29f9dd4e8c5a31a79851cff0b1994c"]),
  ],
  [
    "20260720130000_add_platform_restriction_cases",
    new Set(["0be78fa0e40beeb33d5fa03d80dedf7c1d49118ce7524ea2e43fd56f427f1088"]),
  ],
]);

const targetArgument = process.argv.find((value) => value.startsWith("--target="));
const target = targetArgument?.slice("--target=".length);
const targetConfiguration = {
  local: "LOCAL_DATABASE_URL",
  staging: "STAGING_DATABASE_URL",
  clone: "PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL",
};

if (!(target in targetConfiguration)) {
  fail("Use exactly one read-only target: --target=local|staging|clone");
}

const urlVariable = targetConfiguration[target];
const databaseUrl = process.env[urlVariable];
if (!databaseUrl) fail(`${urlVariable} is required; DATABASE_URL is intentionally ignored.`);

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  fail(`${urlVariable} is not a valid database URL.`);
}

const databaseName = parsedUrl.pathname.replace(/^\//, "");
const targetFingerprint = `${target}:${parsedUrl.hostname}:${parsedUrl.port || "3306"}/${databaseName}`;
if (process.env.SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE !== targetFingerprint) {
  fail(
    `Refusing database access. Set SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE exactly to ${targetFingerprint} after verifying this is not production.`,
  );
}
if (
  target === "local"
  && !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
) {
  fail("The local target must resolve to localhost.");
}

console.log(`[schema-check] Read-only target ${targetFingerprint}`);

const sslMode =
  parsedUrl.searchParams.get("ssl-mode")
  ?? parsedUrl.searchParams.get("sslmode")
  ?? parsedUrl.searchParams.get("sslaccept");
const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? Number(parsedUrl.port) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: databaseName,
  allowPublicKeyRetrieval: true,
  ssl: sslMode ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 30_000,
  socketTimeout: 60_000,
  connectionLimit: 1,
});
const prisma = new PrismaClient({ adapter });

try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM _prisma_migrations
    ORDER BY started_at, migration_name
  `);
  const checksumProblems = [];
  for (const row of rows) {
    if (!row.finished_at || row.rolled_back_at) continue;
    const expected = manifest.migrations[row.migration_name];
    if (!expected && !allowedLegacyMigrationNames.has(row.migration_name)) {
      checksumProblems.push(`${row.migration_name}: applied but absent locally`);
      continue;
    }
    if (expected && !acceptedMigrationHashes(row.migration_name).has(row.checksum)) {
      checksumProblems.push(`${row.migration_name}: database checksum differs`);
    }
  }
  if (checksumProblems.length > 0) {
    for (const problem of checksumProblems) console.error(`- ${problem}`);
    fail("Applied migration checksum verification failed.");
  }
  console.log("[schema-check] Applied migration checksums match recorded SQL.");
} finally {
  await prisma.$disconnect();
}

const environment = { ...process.env, DATABASE_URL: databaseUrl };
runPrisma(
  ["migrate", "status", `--schema=${schemaPath}`],
  environment,
  "Migration status is unhealthy.",
);
runPrisma(
  [
    "migrate",
    "diff",
    "--exit-code",
    "--from-config-datasource",
    "--to-schema",
    schemaPath,
  ],
  environment,
  "Physical database schema differs from prisma/schema.prisma.",
);

console.log("[schema-check] Migration history, checksums, and physical schema agree.");

function runPrisma(args, env, message) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) fail(message, result.status || 1);
}

function acceptedMigrationHashes(name) {
  const contents = readFileSync(
    join(root, "prisma", "migrations", name, "migration.sql"),
    "utf8",
  );
  const lf = contents.replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  return new Set([
    ...[contents, lf, crlf].map((value) =>
      createHash("sha256").update(value).digest("hex"),
    ),
    ...(acceptedHistoricalMigrationHashes.get(name) ?? []),
  ]);
}

function fail(message, code = 1) {
  console.error(`[schema-check] ${message}`);
  process.exit(code);
}
