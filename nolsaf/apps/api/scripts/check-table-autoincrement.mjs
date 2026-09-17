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
    const mode = await connection.query("SELECT @@sql_mode AS mode");
    console.log(`sql_mode: ${mode?.[0]?.mode ?? "unknown"}`);

    for (const table of targets) {
      const safeName = String(table).replace(/[^A-Za-z0-9_]/g, "");
      if (!safeName) continue;

      console.log(`\n=== ${safeName} ===`);
      try {
        // information_schema is the authoritative answer here. Parsing the text
        // of SHOW CREATE TABLE is fragile: the driver does not always hand back
        // that column as a plain string, and an empty parse reads as "missing"
        // when the column is in fact fine.
        // Every literal is bound, never inlined: this server runs with
        // ANSI_QUOTES, where a double quoted value is read as an identifier.
        const columns = await connection.query(
          "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, EXTRA AS extra, COLUMN_KEY AS keyType" +
            " FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
          [config.database, safeName, "id"]
        );

        const idColumn = columns?.[0];
        if (!idColumn) {
          console.log("id column : none (this table has no column called id)");
        } else {
          const extra = String(idColumn.extra || "");
          const isAutoIncrement = /auto_increment/i.test(extra);
          console.log(`id column : ${idColumn.name} ${idColumn.type} ${extra || "(no extra)"} key=${idColumn.keyType || "-"}`);
          console.log(`AUTO_INCREMENT on id : ${isAutoIncrement ? "YES" : "NO  <-- this is the fault"}`);
        }

        const meta = await connection.query(
          "SELECT AUTO_INCREMENT AS nextValue, TABLE_ROWS AS approxRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          [config.database, safeName]
        );
        console.log(`next AUTO_INCREMENT value : ${meta?.[0]?.nextValue ?? "none (table has no auto-increment column)"}`);

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
