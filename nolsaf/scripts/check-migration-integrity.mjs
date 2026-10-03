import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "prisma", "migrations");
const manifestPath = join(root, "prisma", "migration-checksums.json");
const write = process.argv.includes("--write");
const referenceArgument = process.argv.find((value) =>
  value.startsWith("--against-git-ref="),
);
const reference = referenceArgument?.slice("--against-git-ref=".length);

// Applied migrations whose SQL was corrected in place because the original
// cannot execute on production. Each entry pins the exact previous and current
// revision, so any other change is still rejected. Environments that applied
// the previous revision keep their history rows; check-physical-schema.mjs
// accepts that hash as a recorded historical alias.
//
// 20261002090000: the GRANT_BONUS backfill used CAST(... AS JSON), which
// MySQL 8 accepts but production MariaDB 11.8 rejects with ER_PARSE_ERROR.
// JSON_UNQUOTE alone is equivalent on both engines (JSON functions accept JSON
// text). Verified 2026-10-03: identical (zero-row) results on staging MySQL
// 8.0.45, and the corrected SELECT parses on the production-snapshot clone;
// staging, local, and production all have zero GRANT_BONUS audit rows.
const correctedMigrationRevisions = new Map([
  [
    "20261002090000_add_platform_expense_ledger",
    {
      previous: "276129064ce4e13074357b6cc59031bf3050caa6647894fbf48c5cd7c79ee4d4",
      current: "39c49a47db3caf6ae5fb216ac248b0481eb0c9e4e687e1ec93832243214e4a7d",
    },
  ],
]);

function isRecordedCorrection(name, expectedHash, actualHash) {
  const correction = correctedMigrationRevisions.get(name);
  return Boolean(
    correction
      && expectedHash === correction.previous
      && actualHash === correction.current,
  );
}

function hash(contents) {
  // Git stores text with LF while Windows worktrees may expose CRLF. Migration
  // immutability must be platform-independent.
  const canonical = Buffer.isBuffer(contents)
    ? contents.toString("utf8")
    : String(contents);
  return createHash("sha256")
    .update(canonical.replace(/\r\n/g, "\n"))
    .digest("hex");
}

function localChecksums() {
  return Object.fromEntries(
    readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((name) => {
        const sqlPath = join(migrationsDirectory, name, "migration.sql");
        if (!existsSync(sqlPath)) {
          throw new Error(`Migration ${name} has no migration.sql`);
        }
        return [name, hash(readFileSync(sqlPath))];
      }),
  );
}

function readManifest() {
  if (!existsSync(manifestPath)) return { version: 1, migrations: {} };
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (parsed.version !== 1 || typeof parsed.migrations !== "object") {
    throw new Error("Unsupported migration checksum manifest format.");
  }
  return parsed;
}

function failForDifferences(expected, actual, label) {
  const problems = [];
  for (const [name, expectedHash] of Object.entries(expected)) {
    if (!(name in actual)) {
      problems.push(`${name}: missing locally (${label})`);
    } else if (
      actual[name] !== expectedHash
      && !isRecordedCorrection(name, expectedHash, actual[name])
    ) {
      problems.push(`${name}: checksum changed (${label})`);
    }
  }
  return problems;
}

const checksums = localChecksums();
const manifest = readManifest();
let problems = failForDifferences(
  manifest.migrations,
  checksums,
  "checked-in manifest",
);

if (reference) {
  let referenceChecksums;
  try {
    const referenceText = execFileSync(
      "git",
      ["show", `${reference}:nolsaf/prisma/migration-checksums.json`],
      { cwd: resolve(root, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    referenceChecksums = JSON.parse(referenceText).migrations || {};
  } catch {
    // Bootstrap path for the first change that introduces the manifest: hash
    // every migration directly from the base revision.
    let paths;
    try {
      paths = execFileSync(
        "git",
        [
          "ls-tree",
          "-r",
          "--name-only",
          reference,
          "--",
          "nolsaf/prisma/migrations",
        ],
        {
          cwd: resolve(root, ".."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
        .split(/\r?\n/)
        .filter((path) => path.endsWith("/migration.sql"));
    } catch (error) {
      throw new Error(
        `Unable to inspect migrations from ${reference}. Fetch the ref first.`,
        { cause: error },
      );
    }
    referenceChecksums = Object.fromEntries(
      paths.map((path) => {
        const contents = execFileSync("git", ["show", `${reference}:${path}`], {
          cwd: resolve(root, ".."),
          stdio: ["ignore", "pipe", "pipe"],
        });
        const name = path.split("/").at(-2);
        return [name, hash(contents)];
      }),
    );
  }
  problems = problems.concat(
    failForDifferences(
      referenceChecksums,
      checksums,
      `immutable migrations from ${reference}`,
    ),
  );
}

if (problems.length > 0) {
  console.error("Migration integrity check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const unrecorded = Object.keys(checksums).filter(
  (name) => !(name in manifest.migrations),
);

if (write) {
  const nextManifest = {
    version: 1,
    algorithm: "sha256",
    migrations: checksums,
  };
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  console.log(
    `Recorded ${Object.keys(checksums).length} immutable migration checksums.`,
  );
} else if (unrecorded.length > 0) {
  console.error("Migration checksum manifest is missing new migrations:");
  for (const name of unrecorded) console.error(`- ${name}`);
  console.error(
    "After reviewing a new forward-only migration, run: npm run migrations:checksums:update",
  );
  process.exit(1);
} else {
  console.log(
    `Verified ${Object.keys(checksums).length} immutable migration checksums.`,
  );
}
