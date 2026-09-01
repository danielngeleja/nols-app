# Case-sensitive production migration recovery

Status: required release procedure for the `20260822` and `20260823`
case-sensitive migrations. This procedure supplements
[`ENGINEERING_DELIVERY_POLICY.md`](ENGINEERING_DELIVERY_POLICY.md) and
[`PRODUCTION_STABILITY_RUNBOOK.md`](PRODUCTION_STABILITY_RUNBOOK.md); it does not
authorize a production change.

## Why this procedure exists

The following immutable migrations use Prisma model names in SQL even though
the production lineage stores those tables with lowercase physical names and
has `lower_case_table_names=0`:

- `20260822170000_add_user_registration_lifecycle` uses `User` instead of
  `user`;
- `20260823090000_add_property_share_attribution` references `User`, `Property`,
  and `Booking` instead of `user`, `property`, and `booking`;
- `20260823140000_add_trust_verification` references `User` instead of `user`.

Do not edit those shared migration files. The guarded recovery command applies
and independently verifies their exact intended physical and data effects
against the lowercase tables, records only those verified migrations as
applied, and then resumes the ordinary migration chain.

## Mandatory boundaries

- Qualify the exact staging commit on a fresh restored production snapshot
  clone before merging it to `main`.
- Use the exact release archive and its checksum manifest.
- Run from the single designated Elastic Beanstalk migration runner.
- Keep `DATABASE_URL` unchanged. Use only the dedicated recovery URL variable.
- Use strict RDS TLS with the AWS CA bundle.
- Require `@@GLOBAL.log_bin_trust_function_creators = 1` before recovery. The
  final fiscal-security migration creates a trigger and RDS otherwise rejects
  it with error `1419`. Use a disposable parameter group for a clone. For
  production, temporarily change only the existing production group, verify
  the trigger, and restore the parameter to `0` immediately afterward.
- Run the normal migrations only through
  `20260822120000_reconcile_nrms_financial_fk_names` before recovery. This avoids
  deliberately creating a known failed migration row.
- A target mismatch, checksum mismatch, unexpected table case, unexpected
  column/index/foreign-key definition, later migration already applied, or
  non-zero physical diff is a stop condition.
- Production execution requires fresh explicit approval and a verified
  pre-migration recovery snapshot.

## Prepare the exact release runner

Follow section 6 of [`../API_DEPLOYMENT_GUIDE.md`](../API_DEPLOYMENT_GUIDE.md)
to download the exact 40-character release SHA, verify the migration count and
checksums, compare Prisma versions, download the AWS RDS CA, and create the full
release Prisma config. For clone qualification, do not load or reuse the
production URL; construct the clone URL in memory from the clone endpoint and
the credentials already available to the designated runner.

Make the release dependencies available to the immutable archive without
installing anything:

```bash
ln -s /var/app/current/node_modules "$RELEASE_ROOT/node_modules"
```

Create a temporary prefix containing byte-for-byte copies of the release
migrations only through the required prerequisite:

```bash
export RUNNER_ROOT
PREFIX_MIGRATIONS="$RUNNER_ROOT/prisma-prefix"
mkdir "$PREFIX_MIGRATIONS"

for migration in "$RELEASE_ROOT"/prisma/migrations/*; do
  name="$(basename "$migration")"
  if [ "$name" \> "20260822120000_reconcile_nrms_financial_fk_names" ]; then
    continue
  fi
  cp -a "$migration" "$PREFIX_MIGRATIONS/"
done

cat >"$RUNNER_ROOT/prisma-prefix.config.cjs" <<'EOF'
const { defineConfig } = require('/var/app/current/node_modules/prisma/config');

module.exports = defineConfig({
  schema: `${process.env.RELEASE_ROOT}/prisma/schema.prisma`,
  migrations: { path: `${process.env.RUNNER_ROOT}/prisma-prefix` },
  datasource: { url: process.env.DATABASE_URL },
});
EOF

```

Do not execute the prefix until the dedicated target URL is set in the next
section.

## Run the guarded recovery on a clone

Snapshot restore does not preserve the source instance's custom parameter
group. Before connecting, create a disposable MariaDB 11.8 parameter group,
set only the dynamic trigger-creation parameter, and attach it to the clone:

```powershell
$QualificationParameterGroup = "nolsaf-qualification-mariadb11-8-<release-short-sha>"

aws rds create-db-parameter-group `
  --region eu-north-1 `
  --db-parameter-group-name $QualificationParameterGroup `
  --db-parameter-group-family mariadb11.8 `
  --description "Disposable NoLSAF migration qualification"

aws rds modify-db-parameter-group `
  --region eu-north-1 `
  --db-parameter-group-name $QualificationParameterGroup `
  --parameters "ParameterName=log_bin_trust_function_creators,ParameterValue=1,ApplyMethod=immediate"

aws rds modify-db-instance `
  --region eu-north-1 `
  --db-instance-identifier $CloneId `
  --db-parameter-group-name $QualificationParameterGroup `
  --apply-immediately

aws rds wait db-instance-available `
  --region eu-north-1 `
  --db-instance-identifier $CloneId
```

From the designated runner, verify the clone reports
`@@GLOBAL.log_bin_trust_function_creators = 1`. A different value is a stop
condition and the guarded recovery command also enforces it.

Append the CA path to the clone URL used by the runner. Do not print the URL:

```bash
case "$PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL" in
  *\?*) export PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL="${PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL}&sslcert=${RUNNER_ROOT}/rds-global-bundle.pem" ;;
  *) export PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL="${PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL}?sslcert=${RUNNER_ROOT}/rds-global-bundle.pem" ;;
esac

export DATABASE_URL="$PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL"

./node_modules/.bin/prisma migrate deploy \
  --config "$RUNNER_ROOT/prisma-prefix.config.cjs"
```

The last applied migration must be
`20260822120000_reconcile_nrms_financial_fk_names`. Do not continue if it is not.

Derive the sanitized fingerprint locally, inspect it, then supply the two exact
acknowledgements:

```bash
RECOVERY_FINGERPRINT="$(node -e 'const u=new URL(process.env.PRODUCTION_SNAPSHOT_CLONE_DATABASE_URL); console.log(`clone:${u.hostname}:${u.port || "3306"}/${u.pathname.replace(/^\//, "")}`)')"
echo "$RECOVERY_FINGERPRINT"

export MIGRATION_RECOVERY_ACKNOWLEDGE="$RECOVERY_FINGERPRINT"
export MIGRATION_RECOVERY_CONFIRM='repair:clone:20260822170000_add_user_registration_lifecycle,20260823090000_add_property_share_attribution,20260823140000_add_trust_verification'
export MIGRATION_RECOVERY_PRISMA_CLI='/var/app/current/node_modules/prisma/build/index.js'

node "$RELEASE_ROOT/scripts/prisma-migrate-case-recovery.mjs" \
  --target=clone \
  --mode=repair \
  --config="$RUNNER_ROOT/prisma-production.config.cjs"
```

The command must report that recovery, the remaining deploy, and final
verification passed. Then run the independent physical check from the exact
release source:

```bash
export SCHEMA_CHECK_ACKNOWLEDGE_DISPOSABLE="$RECOVERY_FINGERPRINT"
node "$RELEASE_ROOT/scripts/check-physical-schema.mjs" --target=clone
```

Required results are healthy migration history, accepted checksums, and a zero
Prisma physical-schema diff. Also verify
`nrms_fiscal_receipt_prevent_delete` exists on `nrms_fiscal_receipt`. Record
non-sensitive row counts and results. Delete only the exactly named disposable
clone after evidence is captured, wait for deletion, and then delete only the
disposable qualification parameter group. Retain the source recovery snapshot
under the backup-retention policy.

## Production execution after merge

Production uses the same exact committed script and prefix procedure, but only
after all release gates pass, `main` equals the qualified staging SHA, a new
pre-migration recovery snapshot is verified, and the release owner explicitly
approves the production mutation. Put the API in the approved maintenance state
before the prefix deploy so no registration can race the legacy backfill.

Immediately before the prefix deploy, set the dynamic parameter on the existing
production group. This is a production mutation and needs explicit approval:

```powershell
aws rds modify-db-parameter-group `
  --region eu-north-1 `
  --db-parameter-group-name nolsaf-mariadb11-8 `
  --parameters "ParameterName=log_bin_trust_function_creators,ParameterValue=1,ApplyMethod=immediate"
```

Verify the designated runner reads
`@@GLOBAL.log_bin_trust_function_creators = 1` before continuing.

Use the production-only URL and acknowledgements:

```bash
export MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL="$DATABASE_URL"
case "$MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL" in
  *\?*) export MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL="${MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL}&sslcert=${RUNNER_ROOT}/rds-global-bundle.pem" ;;
  *) export MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL="${MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL}?sslcert=${RUNNER_ROOT}/rds-global-bundle.pem" ;;
esac

./node_modules/.bin/prisma migrate deploy \
  --config "$RUNNER_ROOT/prisma-prefix.config.cjs"

PRODUCTION_RECOVERY_FINGERPRINT="$(node -e 'const u=new URL(process.env.MIGRATION_RECOVERY_PRODUCTION_DATABASE_URL); console.log(`production:${u.hostname}:${u.port || "3306"}/${u.pathname.replace(/^\//, "")}`)')"
echo "$PRODUCTION_RECOVERY_FINGERPRINT"

export MIGRATION_RECOVERY_ACKNOWLEDGE="$PRODUCTION_RECOVERY_FINGERPRINT"
export MIGRATION_RECOVERY_CONFIRM='repair:production:20260822170000_add_user_registration_lifecycle,20260823090000_add_property_share_attribution,20260823140000_add_trust_verification'
export MIGRATION_RECOVERY_PRISMA_CLI='/var/app/current/node_modules/prisma/build/index.js'

node "$RELEASE_ROOT/scripts/prisma-migrate-case-recovery.mjs" \
  --target=production \
  --mode=repair \
  --config="$RUNNER_ROOT/prisma-production.config.cjs"
```

After migration status and the physical trigger are verified, restore the
production parameter immediately:

```powershell
aws rds modify-db-parameter-group `
  --region eu-north-1 `
  --db-parameter-group-name nolsaf-mariadb11-8 `
  --parameters "ParameterName=log_bin_trust_function_creators,ParameterValue=0,ApplyMethod=immediate"
```

Verify the group and the running database both report `0`. Failure to restore
the value is a release stop condition.

Afterward, use the ordinary production sequence to verify migration status and
required physical objects, deploy API/web artifacts from the same SHA, and
check health, readiness, worker ownership, logs, and error rates. Do not run the
recovery command again after it succeeds.
