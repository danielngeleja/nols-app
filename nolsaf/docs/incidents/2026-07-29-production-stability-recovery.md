# 2026-07-29 production-stability recovery checklist

Status: local recovery changes implemented; staging, snapshot-clone, and
production actions not authorized and not performed.

## Evidence baseline

- [x] `main` incident baseline is commit `2603884f`.
- [x] Production logs identify Prisma `P2022` for
  `owner_payg_account.maxStaff`; Node terminated and nginx returned 502.
- [x] The same missing column affected `/api/nrms/operations/me`.
- [x] `user.nrmsFinanceRole` already has forward migration
  `20260729010000_add_user_nrms_finance_role`.
- [x] Redis unavailability is independent of the Prisma crash. It disables
  cache-backed behavior and the worker leader lease.
- [x] No production endpoint testing, database connection, infrastructure
  mutation, deploy, commit, or push was performed in this recovery task.

## 1. Async route error containment

- [x] Install a process-wide Express 4 promise rejection bridge before route
  modules are evaluated.
- [x] Preserve the centralized error middleware as the controlled response
  boundary.
- [x] Add regression coverage for a rejected database promise returning 500.
- [x] Prove a subsequent route remains usable.
- [x] Add regression coverage for rejected async middleware.
- [ ] Validate representative authenticated routes on staging and the restored
  snapshot clone.

## 2. Schema-to-migration audit

- [x] Generate the schema from empty with Prisma and audit all 156 tables,
  2,371 columns, 582 indexes, and 279 foreign keys against current migration
  SQL.
- [x] Review migration-file history: 20 migration files changed after initial
  introduction.
- [x] Identify deleted DDL in
  `20260720000000_nrms_safety_controls`: one user column and nine PAYG columns.
- [x] Confirm later forward coverage for `user.nrmsFinanceRole`.
- [x] Confirm later forward coverage for four PAYG freeze columns.
- [x] Confirm missing coverage for five PAYG quota columns.
- [x] Confirm the channel room mapping schema declared a three-column unique
  index while its migration created a different two-column unique index.
- [x] Confirm no other current Prisma table, column, index, or foreign key lacks
  migration coverage after reconciliation.
- [x] Confirm the historical chain is not clean-replayable on MySQL 8:
  `20260714130000_reconcile_legacy_database_drift` uses unsupported
  `DROP FOREIGN KEY IF EXISTS`. Do not edit it; a separately reviewed baseline
  strategy is required.

## 3. Forward reconciliation

- [x] Add one guarded, forward-only migration:
  `20260729020000_reconcile_confirmed_schema_drift`.
- [x] Add the five missing PAYG quota columns only when absent.
- [x] Add the schema-declared channel mapping unique index before dropping the
  obsolete, stricter index.
- [x] Leave every existing migration unchanged.
- [x] Validate the new migration on disposable MySQL by constructing the
  canonical schema, recreating all six drift conditions, applying the guarded
  reconciliation, and requiring a zero physical diff.
- [ ] Apply and validate on staging.
- [ ] Apply and validate on a restored production-snapshot clone.
- [ ] Production apply requires fresh explicit approval after all gates pass.

## 4. Repeatable physical checks

- [x] Add an immutable SHA-256 manifest for 123 migrations.
- [x] Add a base-revision check that rejects edits to older migrations.
- [x] Add target-specific, read-only local/staging/clone physical schema checks.
- [x] Require an exact sanitized disposable-target acknowledgement.
- [x] Compare `_prisma_migrations` checksums, migration status, and physical
  schema; do not rely on status alone.
- [ ] Capture real staging and clone results in the release ticket.

## 5. Redis and workers

- [x] Confirm production defaults workers on in every API process and relies on
  the Redis leader lease for single ownership.
- [x] Confirm workers fail closed when Redis is unavailable.
- [x] Confirm disabling the socket server also prevents workers from starting.
- [x] Remove the implicit production fallback to `redis://localhost:6379`;
  missing `REDIS_URL` is now explicit and fails closed.
- [x] Document safe multi-instance and dedicated-worker topologies.
- [ ] Externally verify sanitized Redis host/port, TLS, authentication, security
  groups/subnets, readiness, and lease renewal. This requires separate approval
  for any AWS configuration change.

## 6. CI and release gate

- [x] Add checksum immutability, coverage, disposable MySQL migration, and
  physical schema checks to CI.
- [x] Make the application build depend on schema integrity.
- [x] Add AWS release stop conditions and forward-only migration workflow.
- [x] Prohibit functional tests and schema experiments on production.

## 7. Local validation

- [x] Focused containment tests.
- [x] API type check.
- [x] Static schema/migration coverage.
- [x] Local migration checksum verification.
- [x] Disposable MySQL reconciliation and physical diff.
- [ ] Establish and validate a clean-history baseline. The legacy migration
  chain cannot currently replay from empty on MySQL 8.
- [x] Full API test suite: 62 files, 331 tests.
- [x] API, Prisma, shared-package, and web production builds.

## Hard stop

Do not move beyond local/staging/snapshot-clone validation or modify
AWS/RDS/Elastic Beanstalk/Vercel/production without fresh, explicit approval.
