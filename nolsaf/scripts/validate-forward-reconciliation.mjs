import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prismaPackage from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const { PrismaClient } = prismaPackage;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const schemaPath = join(root, "prisma", "schema.prisma");
const driftFixture = join(
  root,
  "scripts",
  "fixtures",
  "20260729-confirmed-drift.sql",
);
const reconciliation = join(
  root,
  "prisma",
  "migrations",
  "20260729020000_reconcile_confirmed_schema_drift",
  "migration.sql",
);
const financialFkNameDrift = join(
  root,
  "scripts",
  "fixtures",
  "20260822-nrms-financial-fk-name-drift.sql",
);
const financialFkNameReconciliation = join(
  root,
  "prisma",
  "migrations",
  "20260822120000_reconcile_nrms_financial_fk_names",
  "migration.sql",
);

const databaseUrl = process.env.LOCAL_DATABASE_URL;
if (!databaseUrl) fail("LOCAL_DATABASE_URL is required; DATABASE_URL is ignored.");
const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.replace(/^\//, "");
const fingerprint = `local:${parsedUrl.hostname}:${parsedUrl.port || "3306"}/${databaseName}`;
if (
  !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
  || process.env.SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE !== fingerprint
) {
  fail(`Refusing non-disposable target. Expected acknowledgement: ${fingerprint}`);
}

const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? Number(parsedUrl.port) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: databaseName,
  allowPublicKeyRetrieval: true,
  connectionLimit: 1,
});
const prisma = new PrismaClient({ adapter });
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS tableCount
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);
  if (Number(rows[0]?.tableCount || 0) !== 0) {
    fail("Disposable validation database must be empty.");
  }
} finally {
  await prisma.$disconnect();
}

const environment = { ...process.env, DATABASE_URL: databaseUrl };
const temporaryDirectory = mkdtempSync(join(tmpdir(), "nolsaf-schema-"));
const canonicalSqlPath = join(temporaryDirectory, "canonical.sql");

try {
  const canonical = runPrismaCapture([
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema",
    schemaPath,
    "--script",
  ]);
  writeFileSync(canonicalSqlPath, canonical);

  runPrisma(["db", "execute", `--file=${canonicalSqlPath}`]);
  runPrisma(["db", "execute", `--file=${driftFixture}`]);
  runPrisma(["db", "execute", `--file=${reconciliation}`]);
  // Exercise the already-present path used by partially repaired staging
  // databases as well as the missing-object path above.
  runPrisma(["db", "execute", `--file=${reconciliation}`]);
  runPrisma(["db", "execute", `--file=${financialFkNameDrift}`]);
  runPrisma(["db", "execute", `--file=${financialFkNameReconciliation}`]);
  // The second pass proves the canonical-name path is idempotent.
  runPrisma(["db", "execute", `--file=${financialFkNameReconciliation}`]);
  runPrisma([
    "migrate",
    "diff",
    "--exit-code",
    "--from-config-datasource",
    "--to-schema",
    schemaPath,
  ]);

  console.log(
    "[reconciliation] Guarded migrations repaired confirmed object and FK-name drift, remained idempotent, and produced a zero physical diff.",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`Prisma command failed: ${args.slice(0, 2).join(" ")}`, result.status || 1);
  }
}

function runPrismaCapture(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    fail(`Prisma command failed: ${args.slice(0, 2).join(" ")}`, result.status || 1);
  }
  return result.stdout;
}

function fail(message, code = 1) {
  console.error(`[reconciliation] ${message}`);
  process.exit(code);
}
