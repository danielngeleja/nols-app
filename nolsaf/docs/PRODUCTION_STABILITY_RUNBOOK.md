# NoLSAF production-stability and AWS release runbook

This runbook is a release gate, not permission to change production. Production
AWS, RDS, Elastic Beanstalk, Vercel, and production data remain read-only until
the release owner gives fresh, explicit approval for the exact change.

## Incident stop conditions

Stop the release immediately when any of these is true:

- an applied migration checksum differs from `prisma/migration-checksums.json`;
- `npm run migrations:coverage` reports any table, column, index, or foreign key;
- the physical schema diff is non-empty on staging or the restored snapshot clone;
- any migration fails on disposable MySQL, staging, or the restored snapshot clone;
- the clone does not represent the intended production snapshot;
- Redis is unreachable while background workers are enabled;
- more than one uncoordinated worker process could run;
- focused tests, the full API suite, type checks, or builds fail;
- rollback/recovery ownership, database backup, or maintenance communications are unclear.

Never run functional tests, generated tests, `prisma migrate dev`, `prisma db
push`, or destructive schema experiments against production.

## Immutable migration workflow

1. Create a new timestamped migration. Never edit a migration that has been
   shared or applied.
2. Run:

   ```text
   npm run migrations:coverage
   npm run migrations:checksums
   ```

3. After reviewing a newly added forward-only migration, record it:

   ```text
   npm run migrations:checksums:update
   ```

4. Review the manifest and SQL together. Updating the manifest does not make an
   edit to an older migration acceptable. CI compares migrations already present
   on the base revision and rejects such edits even when the manifest changes.
5. Validate new forward migrations on disposable MySQL and compare the result
   with `prisma/schema.prisma`.

Historical note: the pre-existing migration chain is not replayable from empty
on MySQL 8 because `20260714130000_reconcile_legacy_database_drift` contains
unsupported `DROP FOREIGN KEY IF EXISTS`. Do not edit it. Until a separately
reviewed clean baseline is established, CI validates the current canonical
schema, recreates the confirmed drift on disposable MySQL, runs the forward
reconciliation, and requires a zero physical diff.

## Physical schema verification

`prisma migrate status` is necessary but insufficient. For each approved
non-production target, run the read-only physical check. It verifies database
checksums, migration status, and a Prisma physical-schema diff.

Use only the target-specific URL variable. `DATABASE_URL` is ignored by design:

```text
LOCAL_DATABASE_URL=<local disposable mysql URL>
SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE=local:<host>:<port>/<database>
npm run schema:check:local

STAGING_DATABASE_URL=<staging URL>
SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE=staging:<host>:<port>/<database>
npm run schema:check:staging

PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL=<restored clone URL>
SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE=clone:<host>:<port>/<database>
npm run schema:check:clone
```

The acknowledgement must exactly match the sanitized target fingerprint printed
by the script. It contains no credentials. A production URL must never be placed
in any of these variables.

Functional and data-dependent validation belongs on staging and the restored
snapshot clone only. Record the snapshot timestamp, migration head, schema diff
result, test result, and operator in the release ticket.

## AWS release sequence

These steps require a fresh production-change approval:

1. Confirm the exact commit and migration list are the artifacts validated on
   disposable MySQL, staging, and the restored snapshot clone.
2. Confirm an RDS recovery point and the named recovery operator.
3. Confirm Redis connectivity and worker topology before enabling traffic.
4. Put the API in the approved release/maintenance state.
5. Run `prisma migrate deploy` once from the designated migration runner. Do not
   run it independently from every auto-scaling instance.
6. Check migration output and physical schema before restoring normal traffic.
7. Observe API process restarts, nginx 5xx, Prisma errors, Redis readiness,
   worker lease ownership, and worker health.
8. If a stop condition appears, halt. Do not edit or resolve migration history
   opportunistically. Diagnose on a clone and create another forward migration.

## Redis and worker topology

The API uses `REDIS_URL` for shared caching, rate limiting, session-related
state, and the worker leader lease. Production defaults background workers on;
each web process attempts the lease and only the lease owner runs scheduled
jobs. With Redis unavailable, workers fail closed.

For a multi-instance Elastic Beanstalk environment:

- use a private, authenticated, TLS Redis endpoint reachable from the EB
  instances and configure `REDIS_URL`;
- enable the Socket.IO Redis adapter when Socket.IO runs on multiple instances;
- keep the worker leader lease; never set the uncoordinated override;
- monitor one and only one `nolsaf:workers:leader` owner and lease renewals.

For a dedicated worker tier, explicitly set `RUN_BACKGROUND_WORKERS=false` on
web instances and `true` on the worker process. The worker currently starts from
the Socket.IO-capable API entry point, so `SOCKET_SERVER_ENABLED=false` also
prevents workers from starting. Changing that topology requires its own tested
application change.

`WORKER_SINGLE_INSTANCE=true` plus `ALLOW_UNCOORDINATED_WORKERS=true` is an
emergency/local single-instance override only. It is unsafe under EB rolling
deployments or auto scaling.

Do not print or paste Redis URLs; verify only scheme, sanitized host/port,
network reachability, TLS, authentication success, and the `ready` event.
