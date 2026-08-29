export const USER_REGISTRATION_LIFECYCLE_MIGRATION =
  "20260822170000_add_user_registration_lifecycle";

export const CASE_SENSITIVE_RECOVERY_MIGRATIONS = Object.freeze([
  USER_REGISTRATION_LIFECYCLE_MIGRATION,
  "20260823090000_add_property_share_attribution",
  "20260823140000_add_trust_verification",
]);

export const CASE_SENSITIVE_RECOVERY_PREREQUISITE =
  "20260822120000_reconcile_nrms_financial_fk_names";

export const USER_REGISTRATION_COLUMNS = Object.freeze([
  Object.freeze({
    name: "registrationStatus",
    type: "varchar(30)",
    nullable: false,
    defaultValue: "INCOMPLETE",
    definition: "VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE'",
  }),
  Object.freeze({
    name: "registrationSource",
    type: "varchar(30)",
    nullable: false,
    defaultValue: "UNKNOWN",
    definition: "VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN'",
  }),
  Object.freeze({
    name: "profileCompletedAt",
    type: "datetime(3)",
    nullable: true,
    defaultValue: null,
    definition: "DATETIME(3) NULL",
  }),
]);

export const USER_REGISTRATION_INDEXES = Object.freeze([
  Object.freeze({
    name: "user_role_registrationStatus_idx",
    legacyName: "User_role_registrationStatus_idx",
    columns: Object.freeze(["role", "registrationStatus"]),
  }),
  Object.freeze({
    name: "user_registrationSource_idx",
    legacyName: "User_registrationSource_idx",
    columns: Object.freeze(["registrationSource"]),
  }),
]);

export function assertRecoverableUserTableNames(exactTableNames) {
  const names = new Set(exactTableNames);
  if (!names.has("user")) {
    throw new Error("the exact lowercase table user is missing");
  }
  if (names.has("User")) {
    throw new Error(
      "an exact-case User table also exists; reconcile the duplicate table before recovery",
    );
  }
}

export function missingUserRegistrationColumns(existingColumnNames) {
  const existing = new Set(existingColumnNames.map((name) => name.toLowerCase()));
  return USER_REGISTRATION_COLUMNS.filter(
    (column) => !existing.has(column.name.toLowerCase()),
  );
}

export function missingUserRegistrationIndexes(existingIndexes) {
  const existingShapes = new Set(
    existingIndexes
      .filter((index) => index.unique !== true)
      .map((index) =>
        index.columns.map((column) => column.toLowerCase()).join(","),
      ),
  );
  return USER_REGISTRATION_INDEXES.filter(
    (index) =>
      !existingShapes.has(index.columns.map((column) => column.toLowerCase()).join(",")),
  );
}

export function recoveryTargetFingerprint(target, databaseUrl) {
  if (!new Set(["clone", "production"]).has(target)) {
    throw new Error("target must be clone or production");
  }
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) throw new Error("database name is missing");
  return `${target}:${parsed.hostname}:${parsed.port || "3306"}/${database}`;
}

export function assertRecoveryTargetHost(target, hostname) {
  const productionHost = "database-1.cl6m044mi2nr.eu-north-1.rds.amazonaws.com";
  if (target === "clone") {
    if (hostname === productionHost) {
      throw new Error("clone mode cannot target the production endpoint");
    }
    if (!hostname.startsWith("database-1-migration-test-")) {
      throw new Error("clone hostname is not an approved disposable RDS clone");
    }
    return;
  }
  if (target === "production" && hostname !== productionHost) {
    throw new Error("production mode must target the documented production endpoint");
  }
}

export function classifyRecoveryMigration(rows, migrationName) {
  const matching = rows.filter((row) => row.migration_name === migrationName);
  if (matching.some((row) => row.finished_at && !row.rolled_back_at)) return "applied";
  if (matching.some((row) => !row.finished_at && !row.rolled_back_at)) return "failed";
  return "pending";
}

export function normalizeInformationSchemaDefault(value) {
  if (value == null || String(value).toUpperCase() === "NULL") return null;
  const text = String(value);
  if (
    text.length >= 2 &&
    ((text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')))
  ) {
    return text.slice(1, -1).replaceAll("''", "'").replaceAll('""', '"');
  }
  return text;
}

export function isExpectedFiscalDeleteTrigger(row) {
  if (!row) return false;
  const statement = String(row.action_statement ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return (
    row.action_timing === "BEFORE" &&
    row.event_manipulation === "DELETE" &&
    row.event_object_table === "nrms_fiscal_receipt" &&
    statement.includes("SIGNAL SQLSTATE '45000'") &&
    statement.includes("FISCAL RECEIPTS ARE IMMUTABLE AND CANNOT BE DELETED")
  );
}
