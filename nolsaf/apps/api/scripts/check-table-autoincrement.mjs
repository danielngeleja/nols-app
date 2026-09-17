// Read only check: does a table's primary key still have AUTO_INCREMENT?
//
// Why this exists: a MySQL table whose `id` has lost AUTO_INCREMENT still
// accepts inserts (writing id = 0), but Prisma's create reads the row back by
// the reported insert id, finds nothing, and resolves to null. That surfaced as
// "Cannot read properties of null (reading 'id')" on POST /api/public/bookings
// when transport was included.
//
// Usage (inside the deployed service, or anywhere DATABASE_URL points at the
// database you want to inspect):
//
//   node apps/api/scripts/check-table-autoincrement.mjs
//   node apps/api/scripts/check-table-autoincrement.mjs transportbooking booking
//
// It runs SHOW CREATE TABLE and reads information_schema. It writes nothing.

import mariadb from "mariadb";

const DEFAULT_TABLES = ["transportbooking", "booking"];

function connectionFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const ca = String(process.env.DB_SSL_CA || "").replace(/\\n/g, "\n").trim();
  const wantsSsl =
    Boolean(url.searchParams.get("sslaccept") || url.searchParams.get("ssl-mode") || url.searchParams.get("sslmode")) ||
    process.env.NODE_ENV === "production";

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: url.pathname.replace(/^\/+/, "") || undefined,
    // Keep certificate verification on. Pass DB_SSL_CA the same way the app does.
    ssl: wantsSsl ? (ca ? { ca } : true) : undefined,
    connectTimeout: 10000,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const tables = process.argv.slice(2).filter(Boolean);
  const targets = tables.length ? tables : DEFAULT_TABLES;

  const config = connectionFromDatabaseUrl(databaseUrl);
  console.log(`Database: ${config.database} on ${config.host}:${config.port}`);

  const connection = await mariadb.createConnection(config);
  try {
    for (const table of targets) {
      const safeName = String(table).replace(/[^A-Za-z0-9_]/g, "");
      if (!safeName) continue;

      console.log(`\n=== ${safeName} ===`);
      try {
        const rows = await connection.query(`SHOW CREATE TABLE \`${safeName}\``);
        const ddl = String(rows?.[0]?.["Create Table"] || "");
        const idLine = ddl.split(/\r?\n/).find((line) => /^\s*`id`/.test(line)) || "(no id column found)";
        const hasAutoIncrement = /`id`[^,]*AUTO_INCREMENT/i.test(ddl);

        console.log(`id column : ${idLine.trim()}`);
        console.log(`AUTO_INCREMENT on id : ${hasAutoIncrement ? "YES" : "NO  <-- this is the fault"}`);

        const meta = await connection.query(
          "SELECT AUTO_INCREMENT AS nextValue, TABLE_ROWS AS approxRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          [config.database, safeName]
        );
        console.log(`next AUTO_INCREMENT value : ${meta?.[0]?.nextValue ?? "none"}`);

        const zeroRow = await connection.query(`SELECT COUNT(*) AS zeros FROM \`${safeName}\` WHERE id = 0`);
        const zeros = Number(zeroRow?.[0]?.zeros ?? 0);
        console.log(`rows sitting at id = 0 : ${zeros}${zeros > 0 ? "  <-- written by a failed insert" : ""}`);
      } catch (err) {
        console.error(`could not read ${safeName}: ${err?.message || err}`);
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
