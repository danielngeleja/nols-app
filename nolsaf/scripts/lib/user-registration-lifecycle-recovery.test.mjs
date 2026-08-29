import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRecoverableUserTableNames,
  assertRecoveryTargetHost,
  classifyRecoveryMigration,
  missingUserRegistrationColumns,
  missingUserRegistrationIndexes,
  recoveryTargetFingerprint,
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

test("binds recovery acknowledgement to an exact target", () => {
  assert.equal(
    recoveryTargetFingerprint(
      "clone",
      "mysql://operator:secret@database-1-migration-test-20260829-190000.example:3307/nolsaf_production",
    ),
    "clone:database-1-migration-test-20260829-190000.example:3307/nolsaf_production",
  );
  assert.throws(
    () => recoveryTargetFingerprint("staging", "mysql://u:p@host/database"),
    /target must be clone or production/,
  );
});

test("keeps clone and production endpoints separate", () => {
  assert.doesNotThrow(() =>
    assertRecoveryTargetHost(
      "clone",
      "database-1-migration-test-20260829-190000.cl6m044mi2nr.eu-north-1.rds.amazonaws.com",
    ),
  );
  assert.throws(
    () =>
      assertRecoveryTargetHost(
        "clone",
        "database-1.cl6m044mi2nr.eu-north-1.rds.amazonaws.com",
      ),
    /cannot target the production endpoint/,
  );
  assert.doesNotThrow(() =>
    assertRecoveryTargetHost(
      "production",
      "database-1.cl6m044mi2nr.eu-north-1.rds.amazonaws.com",
    ),
  );
});

test("classifies migration history without manufacturing success", () => {
  const migration = "20260822170000_add_user_registration_lifecycle";
  assert.equal(classifyRecoveryMigration([], migration), "pending");
  assert.equal(
    classifyRecoveryMigration(
      [{ migration_name: migration, finished_at: null, rolled_back_at: null }],
      migration,
    ),
    "failed",
  );
  assert.equal(
    classifyRecoveryMigration(
      [{ migration_name: migration, finished_at: new Date(), rolled_back_at: null }],
      migration,
    ),
    "applied",
  );
});
