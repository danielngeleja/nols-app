export const USER_REGISTRATION_LIFECYCLE_MIGRATION =
  "20260822170000_add_user_registration_lifecycle";

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
