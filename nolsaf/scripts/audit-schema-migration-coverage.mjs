import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "prisma", "schema.prisma");
const migrationsPath = join(root, "prisma", "migrations");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");

const diff = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema",
    schemaPath,
    "--script",
  ],
  { cwd: root, encoding: "utf8" },
);

if (diff.status !== 0) {
  process.stderr.write(diff.stderr || diff.stdout);
  process.exit(diff.status || 1);
}

const expectedSql = diff.stdout;
const migrationSql = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) =>
    readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"),
  )
  .join("\n");

const expectedTables = new Map();
for (const match of expectedSql.matchAll(
  /CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\)\s*(?:DEFAULT|;)/gi,
)) {
  const [, table, body] = match;
  const columns = new Set(
    [...body.matchAll(/(?:^|,)\s*`([^`]+)`\s+/gm)].map(
      (column) => column[1],
    ),
  );
  expectedTables.set(table, columns);
}

const migrationTables = new Map();
function tableColumns(table) {
  const key = table.toLowerCase();
  if (!migrationTables.has(key)) migrationTables.set(key, new Set());
  return migrationTables.get(key);
}

for (const match of migrationSql.matchAll(
  /CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)`\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT|;)/gi,
)) {
  const [, table, body] = match;
  const columns = tableColumns(table);
  for (const column of body.matchAll(/(?:^|,)\s*`([^`]+)`\s+/gm)) {
    columns.add(column[1].toLowerCase());
  }
}

// A few guarded legacy migrations put DDL in a prepared SQL string and use
// unquoted identifiers. Include those declarations in coverage without
// executing the migration.
for (const match of migrationSql.matchAll(
  /CREATE TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT|;)/gi,
)) {
  const [, table, body] = match;
  const columns = tableColumns(table);
  for (const column of body.matchAll(
    /^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s+(?:BIGINT|INT|INTEGER|VARCHAR|DECIMAL|DATETIME|DATE|BOOLEAN|JSON|TEXT)\b/gim,
  )) {
    columns.add(column[1].toLowerCase());
  }
}

for (const match of migrationSql.matchAll(
  /ALTER TABLE `([^`]+)`([\s\S]*?);/gi,
)) {
  const [, table, body] = match;
  const columns = tableColumns(table);
  for (const column of body.matchAll(
    /(?:ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?|MODIFY(?:\s+COLUMN)?|CHANGE(?:\s+COLUMN)?\s+`[^`]+`)\s+`([^`]+)`/gi,
  )) {
    columns.add(column[1].toLowerCase());
  }
}

const missingTables = [];
const missingColumns = [];
for (const [table, columns] of expectedTables) {
  const covered = migrationTables.get(table.toLowerCase());
  if (!covered) {
    missingTables.push(table);
    continue;
  }
  for (const column of columns) {
    if (!covered.has(column.toLowerCase())) {
      missingColumns.push(`${table}.${column}`);
    }
  }
}

const expectedIndexes = new Set(
  [...expectedSql.matchAll(/(?:UNIQUE\s+)?INDEX `([^`]+)`/gi)].map(
    (match) => match[1],
  ),
);
const expectedForeignKeys = new Set(
  [...expectedSql.matchAll(/ADD CONSTRAINT `([^`]+)` FOREIGN KEY/gi)].map(
    (match) => match[1],
  ),
);
const missingIndexes = [...expectedIndexes].filter(
  (name) =>
    !new RegExp(
      `(?:(?:INDEX|KEY)(?:\\s+IF\\s+NOT\\s+EXISTS)?|TO)\\s+\`?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`?`,
      "i",
    ).test(migrationSql),
);

function identifierList(value) {
  return value
    .split(",")
    .map((part) => part.replaceAll("`", "").trim().toLowerCase())
    .join(",");
}

const expectedForeignKeyDefinitions = [
  ...expectedSql.matchAll(
    /ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\(([^)]+)\)/gi,
  ),
].map((match) => ({
  table: match[1],
  name: match[2],
  columns: identifierList(match[3]),
  referencedTable: match[4].toLowerCase(),
  referencedColumns: identifierList(match[5]),
}));

function hasSemanticForeignKey(expected) {
  const escapedTable = expected.table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tableStatement = new RegExp(
    `(?:CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE)\\s+\`?${escapedTable}\`?([\\s\\S]*?);`,
    "gi",
  );
  for (const statement of migrationSql.matchAll(tableStatement)) {
    for (const foreignKey of statement[1].matchAll(
      /FOREIGN KEY(?:\s+IF\s+NOT\s+EXISTS)?\s*\(([^)]+)\)\s*REFERENCES\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([^)]+)\)/gi,
    )) {
      if (
        identifierList(foreignKey[1]) === expected.columns
        && foreignKey[2].toLowerCase() === expected.referencedTable
        && identifierList(foreignKey[3]) === expected.referencedColumns
      ) {
        return true;
      }
    }
  }
  return false;
}

const missingForeignKeys = expectedForeignKeyDefinitions
  .filter((definition) => !hasSemanticForeignKey(definition))
  .map((definition) => definition.name);

const report = {
  expected: {
    tables: expectedTables.size,
    columns: [...expectedTables.values()].reduce(
      (count, columns) => count + columns.size,
      0,
    ),
    indexes: expectedIndexes.size,
    foreignKeys: expectedForeignKeys.size,
  },
  missingTables,
  missingColumns,
  missingIndexes,
  missingForeignKeys,
};

console.log(JSON.stringify(report, null, 2));
if (
  missingTables.length
  || missingColumns.length
  || missingIndexes.length
  || missingForeignKeys.length
) {
  process.exit(1);
}
