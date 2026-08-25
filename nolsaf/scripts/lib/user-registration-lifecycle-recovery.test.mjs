import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRecoverableUserTableNames,
  missingUserRegistrationColumns,
  missingUserRegistrationIndexes,
} from "./user-registration-lifecycle-recovery.mjs";

test("requires the exact lowercase user table", () => {
  assert.throws(
    () => assertRecoverableUserTableNames([]),
    /exact lowercase table user is missing/,
  );
  assert.throws(
    () => assertRecoverableUserTableNames(["user", "User"]),
    /exact-case User table also exists/,
  );
  assert.doesNotThrow(() => assertRecoverableUserTableNames(["user"]));
});

test("plans only missing registration lifecycle columns", () => {
  assert.deepEqual(
    missingUserRegistrationColumns(["registrationStatus"]).map((column) => column.name),
    ["registrationSource", "profileCompletedAt"],
  );
  assert.deepEqual(
    missingUserRegistrationColumns([
      "REGISTRATIONSTATUS",
      "registrationSource",
      "profileCompletedAt",
    ]),
    [],
  );
});

test("recognizes equivalent indexes by ordered column shape", () => {
  assert.deepEqual(
    missingUserRegistrationIndexes([
      {
        name: "custom_role_status",
        unique: false,
        columns: ["role", "registrationStatus"],
      },
    ]).map((index) => index.name),
    ["user_registrationSource_idx"],
  );
  assert.deepEqual(
    missingUserRegistrationIndexes([
      {
        name: "status_role_wrong_order",
        unique: false,
        columns: ["registrationStatus", "role"],
      },
      { name: "source", unique: false, columns: ["registrationSource"] },
    ]).map((index) => index.name),
    ["user_role_registrationStatus_idx"],
  );
  assert.deepEqual(
    missingUserRegistrationIndexes([
      {
        name: "too_restrictive",
        unique: true,
        columns: ["registrationSource"],
      },
    ]).map((index) => index.name),
    ["user_role_registrationStatus_idx", "user_registrationSource_idx"],
  );
});
