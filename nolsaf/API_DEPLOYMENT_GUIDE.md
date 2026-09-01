# NoLSAF AWS Production Deployment Runbook

This runbook implements the production phase of the authoritative
[`docs/ENGINEERING_DELIVERY_POLICY.md`](docs/ENGINEERING_DELIVERY_POLICY.md).
It is the executable procedure for deploying the NoLSAF API and Prisma
migrations to AWS production, but it does not authorize production changes or
replace staging and clone qualification.

## Production resources

| Resource | Value |
| --- | --- |
| AWS region | `eu-north-1` |
| Elastic Beanstalk application | `nolsaf-api` |
| Elastic Beanstalk environment | `nolsaf-api-production-alb` |
| Production RDS instance | `database-1` |
| Production database | `nolsaf_production` |
| Production API health URL | `https://api.nolsaf.com/health` |
| Source branch | `main` |
| Prisma schema | `prisma/schema.prisma` |
| Prisma migrations | `prisma/migrations/` |
| API deployment script | `apps/api/scripts/deploy-eb.ps1` |
| Operator entry point | `scripts/aws-production.ps1` |

The commands below assume Windows PowerShell.

```powershell
$RepoRoot = "D:\nolsapp2.1\nolsaf"
$ApiDir = "$RepoRoot\apps\api"
$Eb = "C:\Users\NoLS Tanzania\AppData\Roaming\Python\Python312\Scripts\eb.exe"
$AwsRegion = "eu-north-1"
$EbEnvironment = "nolsaf-api-production-alb"
$RdsInstance = "database-1"
```

Keep the same PowerShell window open throughout the release so these variables
remain available.

## Non-negotiable production rules

- Treat `staging` as the single QA source of truth. Complete all functional,
  authenticated workflow, responsive UI, regression, migration-rehearsal, and
  schema-drift testing there or on a disposable/restored snapshot clone before
  merging into `main`.
- Deploy production only from a clean `main` branch that matches `origin/main`.
- Treat AWS Elastic Beanstalk and production RDS as deployment targets only.
  Never run test suites, generated test data, load tests, seed scripts, schema
  experiments, or exploratory QA against production.
- Use `apps/api/scripts/deploy-eb.ps1`; do not use raw `eb deploy` for a normal
  release.
- Create and verify an RDS snapshot before applying production migrations.
- For a schema-bearing release, run the exact approved `main` migration artifact
  from the designated single runner and verify it before deploying dependent
  API code. Never use the post-deployment application directory as the first
  opportunity to apply required schema.
- Use `prisma migrate deploy` from that designated runner only.
- Never run `prisma migrate dev`, `prisma db push`, or
  `prisma db push --accept-data-loss` against production.
- Never rename, reorder, or delete a migration already applied to a shared
  database. Add a new forward-only migration instead.
- Never print or paste `DATABASE_URL`, JWT secrets, encryption keys, or AWS
  credentials into logs, documentation, Git, or support messages.
- If Elastic Beanstalk is `Red`, the API health check fails, migration files are
  missing, or Prisma reports a failed migration, stop and investigate before
  continuing.

## Operator entry point

`scripts/aws-production.ps1` is the guarded local entry point for the AWS-facing
steps of this runbook. It is a wrapper, not a replacement: it does not perform
staging QA, promotion, snapshots, or migrations, and it never removes the need
for the approvals and evidence required by
[`docs/ENGINEERING_DELIVERY_POLICY.md`](docs/ENGINEERING_DELIVERY_POLICY.md).

Run it from the repository root:

```powershell
Set-Location $RepoRoot
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\aws-production.ps1 help
```

| Action | Runbook section | Effect on AWS |
| --- | --- | --- |
| `preflight` | 3 | Read-only |
| `status` | 3, 9 | Read-only |
| `validate` | 5 | None; local bundle build only |
| `deploy` | 7 | Deploys a new application version |
| `health` | 3, 9 | Read-only |
| `events` | 7, 9 | Read-only |
| `logs` | 7, 9 | Read-only |
| `ssh` | 6, 8 | Opens an interactive session |
| `open`, `console` | Any | Read-only |

The `deploy` action fails closed. It requires `-ConfirmProduction`, an explicit
`-DatabaseChange` state, and a clean `main` checkout whose `HEAD` matches
`origin/main`. It then runs `apps/api/scripts/deploy-eb.ps1` and prints EB, RDS,
and public health status.

```powershell
# Application-only release with no Prisma or database-compatibility change
.\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange None

# Schema-bearing release, only after section 6 completed and was verified
.\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange AppliedAndVerified
```

`-DatabaseChange AppliedAndVerified` is an operator acknowledgement, not a check.
The script cannot prove that the exact `main` migration artifact was applied and
verified by the designated runner. Never pass it to skip section 6.

Use `-Profile <name>` when the correct production credentials are not the default
AWS profile. The AWS region defaults to `eu-north-1`.

The manual commands in the sections below remain authoritative. Use them
directly whenever the wrapper is unavailable, when its output is ambiguous, or
when a release is being investigated after a failure.

## 1. QA the staging branch

Start at the repository root:

```powershell
Set-Location $RepoRoot
git switch staging
git pull --ff-only origin staging
git status --short
```

`git status --short` must be empty before continuing.

Install exactly the dependencies in `package-lock.json`, then run the release
checks:

```powershell
npm ci
npm run lint
npm run typecheck
npm --workspace=@nolsaf/api test
npm run build
```

All commands must exit successfully. Deprecation warnings from `npm ci` are not
deployment failures, but should be scheduled for dependency maintenance.

If Prisma changed, review the migration SQL before promotion:

```powershell
git diff origin/main...staging -- prisma/schema.prisma prisma/migrations
(Get-ChildItem "$RepoRoot\prisma\migrations" -Filter migration.sql -Recurse -File).Count
```

Migration review checklist:

- Destructive operations have an explicit data-preservation plan.
- Backfills can be safely retried.
- Drift-reconciliation SQL uses MariaDB-supported `IF EXISTS` or
  `IF NOT EXISTS` guards where appropriate.
- A migration does not reference a column before creating it.
- Foreign-key additions have been checked for orphaned rows.
- Do not use case-only `RENAME INDEX` operations on MariaDB. If an index name
  must change only by letter case, rebuild it with a new forward migration and
  test the rebuilt index explicitly.
- Large reconciliation migrations have been tested against a recent production
  snapshot clone.

## 2. Promote `staging` to `main`

Do this only after QA and staging approval:

```powershell
Set-Location $RepoRoot
git switch staging
git pull --ff-only origin staging
git status --short

git switch main
git pull --ff-only origin main
git merge --no-ff staging -m "release: promote staging to production"
```

Run the critical checks again on the exact production commit:

```powershell
npm ci
npm run lint
npm run typecheck
npm --workspace=@nolsaf/api test
npm run build
git status --short
```

Push only after every check passes:

```powershell
git push origin main
git fetch origin main

$LocalMain = git rev-parse HEAD
$RemoteMain = git rev-parse origin/main
if ($LocalMain -ne $RemoteMain) {
    throw "Local main does not match origin/main."
}
```

```powershell
$ReleaseSha = $LocalMain.Trim()
$MigrationCount = (Get-ChildItem "$RepoRoot\prisma\migrations" `
  -Filter migration.sql -Recurse -File).Count
$ReleaseSha
$MigrationCount
```

If the merge reports no changes and `main` already matches `origin/main`, do not
create an empty commit.

## 3. Confirm AWS identity and current API health

```powershell
aws sts get-caller-identity
& $Eb status

$BeforeDeploy = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "https://api.nolsaf.com/health" `
  -TimeoutSec 30

$BeforeDeploy.StatusCode
$BeforeDeploy.Content
```

Required pre-deployment state:

- The AWS account and region are correct.
- Elastic Beanstalk points to `nolsaf-api-production-alb`.
- EB status is `Ready`.
- The health endpoint returns HTTP `200`.

Record the current `Deployed Version` from `eb status`. It is the application
rollback candidate if the new API bundle fails.

The same read-only checks, plus RDS instance state, are available as:

```powershell
Set-Location $RepoRoot
.\scripts\aws-production.ps1 status
```

## 4. Create and verify the production RDS snapshot

Create a unique snapshot:

```powershell
$SnapshotId = "database-1-premigrate-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

aws rds create-db-snapshot `
  --region $AwsRegion `
  --db-instance-identifier $RdsInstance `
  --db-snapshot-identifier $SnapshotId
```

Wait until it is available:

```powershell
aws rds wait db-snapshot-available `
  --region $AwsRegion `
  --db-snapshot-identifier $SnapshotId
```

The wait command normally prints nothing while it is working. Do not interrupt
it. When the PowerShell prompt returns, verify the snapshot:

```powershell
aws rds describe-db-snapshots `
  --region $AwsRegion `
  --db-snapshot-identifier $SnapshotId `
  --query "DBSnapshots[0].[DBSnapshotIdentifier,Status,DBInstanceIdentifier,Encrypted,SnapshotCreateTime]"
```

Required result:

- Snapshot identifier matches `$SnapshotId`.
- Status is `available`.
- Source instance is `database-1`.
- Encryption is `true`.

Do not continue to production migrations while the snapshot is `creating`.

## 5. Validate the Elastic Beanstalk bundle locally

The deployment script builds the production-only API with private source maps,
vendors required workspace packages, materializes a runtime-only package
manifest from the repository-pinned EB lock, stages the root Prisma schema and
migrations plus all controlled contract artifacts, validates the bundle, and
cleans its temporary files.

```powershell
Set-Location $ApiDir
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\deploy-eb.ps1 `
  -ValidateOnly
```

The wrapper equivalent is `.\scripts\aws-production.ps1 validate` from
`$RepoRoot`. Either form must end with the same result.

Expected ending:

```text
=== [deploy-eb] Validation passed; no AWS deployment was performed. ===
```

Verify cleanup:

```powershell
Set-Location $RepoRoot
git status --short
Test-Path "$ApiDir\_workspace"
Test-Path "$ApiDir\package.json.predeploy-bak"
Test-Path "$ApiDir\package-lock.json"
Test-Path "$ApiDir\prisma"
Test-Path "$ApiDir\docs"
```

Git status must be empty and all five `Test-Path` commands must return `False`.

## 6. Apply approved Prisma migrations from the exact `main` commit

Skip this section only when the exact staging-to-main diff proves there is no
Prisma schema, migration, or database-compatibility change. This is the single
designated migration runner; do not run the same migration from multiple EB
instances.

Connect to one production EB instance:

```powershell
Set-Location $ApiDir
& $Eb ssh $EbEnvironment
```

Inside the Linux SSH session, download the immutable source archive for the
approved 40-character `main` SHA. Paste the recorded values; never use a branch
name such as `main` in the URL.

```bash
set -euo pipefail
cd /var/app/current

RELEASE_SHA="<paste $ReleaseSha>"
EXPECTED_MIGRATION_COUNT="<paste $MigrationCount>"

test "${#RELEASE_SHA}" -eq 40 || {
  echo "Release SHA must contain exactly 40 characters" >&2; exit 1;
}
case "$RELEASE_SHA" in
  *[!0-9a-f]*) echo "Release SHA must be lowercase hexadecimal" >&2; exit 1 ;;
  *) ;;
esac

case "$EXPECTED_MIGRATION_COUNT" in
  ''|*[!0-9]*) echo "Invalid migration count" >&2; exit 1 ;;
esac

RUNNER_ROOT="$(mktemp -d "/tmp/nolsaf-migration-${RELEASE_SHA}.XXXXXX")"
ARCHIVE="$RUNNER_ROOT/release.tar.gz"
trap 'rm -rf -- "$RUNNER_ROOT"' EXIT

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "https://github.com/danielngeleja/nols-app/archive/${RELEASE_SHA}.tar.gz" \
  -o "$ARCHIVE"

mkdir "$RUNNER_ROOT/source"
tar -xzf "$ARCHIVE" -C "$RUNNER_ROOT/source" --strip-components=1
export RELEASE_ROOT="$RUNNER_ROOT/source/nolsaf"

test -f "$RELEASE_ROOT/prisma/schema.prisma"
test -d "$RELEASE_ROOT/prisma/migrations"
test -f "$RELEASE_ROOT/prisma/migration-checksums.json"
test -f "$RELEASE_ROOT/scripts/check-migration-integrity.mjs"
test -x /var/app/current/node_modules/.bin/prisma

test "$(find "$RELEASE_ROOT/prisma/migrations" -name migration.sql -type f | wc -l)" \
  -eq "$EXPECTED_MIGRATION_COUNT"

node "$RELEASE_ROOT/scripts/check-migration-integrity.mjs"

CURRENT_PRISMA_VERSION="$(node -p "require('/var/app/current/package.json').dependencies.prisma")"
RELEASE_PRISMA_VERSION="$(node -p "require(process.env.RELEASE_ROOT + '/package.json').dependencies.prisma")"
test "$CURRENT_PRISMA_VERSION" = "$RELEASE_PRISMA_VERSION"
```

A Prisma CLI version mismatch is a stop condition. Build a separately reviewed
migration-runner artifact with the exact release dependency instead of installing
an unpinned package on production.

Load the production URL without printing it, download the official AWS RDS CA,
and configure Prisma against the exact release source:

```bash
export DATABASE_URL="$(/opt/elasticbeanstalk/bin/get-config environment -k DATABASE_URL)"
test -n "$DATABASE_URL"

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o "$RUNNER_ROOT/rds-global-bundle.pem"
test -s "$RUNNER_ROOT/rds-global-bundle.pem"

case "$DATABASE_URL" in
  *\?*) export DATABASE_URL="${DATABASE_URL}&sslcert=${RUNNER_ROOT}/rds-global-bundle.pem&sslaccept=strict" ;;
  *) export DATABASE_URL="${DATABASE_URL}?sslcert=${RUNNER_ROOT}/rds-global-bundle.pem&sslaccept=strict" ;;
esac

cat >"$RUNNER_ROOT/prisma-production.config.cjs" <<'EOF'
const { defineConfig } = require('/var/app/current/node_modules/prisma/config');

module.exports = defineConfig({
  schema: `${process.env.RELEASE_ROOT}/prisma/schema.prisma`,
  migrations: {
    path: `${process.env.RELEASE_ROOT}/prisma/migrations`,
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
EOF

./node_modules/.bin/prisma migrate status \
  --config "$RUNNER_ROOT/prisma-production.config.cjs"

# Stop here when the release contains
# 20260822170000_add_user_registration_lifecycle. Use the guarded prefix and
# recovery sequence in docs/CASE_SENSITIVE_DATABASE_RECOVERY.md instead of the
# next migrate-deploy command.

./node_modules/.bin/prisma migrate deploy \
  --config "$RUNNER_ROOT/prisma-production.config.cjs"

./node_modules/.bin/prisma migrate status \
  --config "$RUNNER_ROOT/prisma-production.config.cjs"
```

Required final output is `Database schema is up to date!`. If Prisma reports a
failed migration, an unexpected database, a checksum problem, or a connection
error, stop. Do not use `migrate resolve` merely to silence the error.

Exit the SSH session. The trap removes only the uniquely created runner folder:

```bash
exit
```

## 7. Deploy the API bundle after schema verification

```powershell
Set-Location $ApiDir
$env:PYTHONUTF8 = "1"

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\deploy-eb.ps1
```

The guarded wrapper form re-checks the release checkout before deploying and
prints EB, RDS, and health status afterwards:

```powershell
Set-Location $RepoRoot
.\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange None
```

Use `-DatabaseChange AppliedAndVerified` instead when section 6 applied and
verified migrations for this release.

Do not run another deploy while this command is active. A successful deployment
ends with:

```text
Environment update completed successfully.
=== [deploy-eb] Deployment completed. ===
```

Confirm the new bundle:

```powershell
& $Eb status
```

Required deployment state:

- `Deployed Version` changed to the new application version.
- Status is `Ready`.
- Health is `Green`.

Yellow health can be temporary during startup. Wait and check again. Do not
continue verification while the environment is updating or unhealthy.

If deployment fails:

```powershell
& $Eb status
& $Eb events $EbEnvironment
& $Eb logs $EbEnvironment --all
```

Resolve the API deployment failure without rerunning the migration or launching
another deploy blindly. The schema expansion may already be committed and must
remain backward-compatible with the rollback API version.

### Run the guarded room-code backfill for stable room variants

The deployed API contains the exact backfill runner under `dist/scripts`. Run
its dry-run first from one Elastic Beanstalk instance; never run it concurrently
from multiple instances.

```powershell
Set-Location $ApiDir
& $Eb ssh $EbEnvironment
```

Inside the SSH session:

```bash
set -euo pipefail
cd /var/app/current
npm run rooms:codes:backfill:runtime
```

Required dry-run result:

- `mode` is `dry-run`;
- `activeBlockers` is `0`;
- `safeToApply` is `true`;
- every planned booking/block rewrite points to one explicit target code.

An active ambiguous reference is a stop condition. Do not choose the first
candidate. Reconcile the booking or availability block with the property owner,
assign its exact variant code through a reviewed data correction, and rerun the
dry-run. Historical unresolved references are reported but do not affect
current or future inventory.

After a clean dry-run, apply once and prove the rerun is empty:

```bash
npm run rooms:codes:backfill:runtime:apply
npm run rooms:codes:backfill:runtime
```

The final dry-run must report `propertiesToChange: 0`,
`plannedReferenceUpdates: 0`, and `activeBlockers: 0`. The runner locks and
rechecks each property before writing, updates safe booking/block references in
the same transaction as `roomsSpec`, and is idempotent. Preserve the RDS
snapshot from section 4 until post-deployment verification is complete.

```bash
exit
```

## 8. Verify the deployed bundle carries the applied migration head

Connect to the production instance:

```powershell
Set-Location $ApiDir
& $Eb ssh $EbEnvironment
```

The following commands run inside the Linux SSH session.

First verify the deployed Prisma bundle:

```bash
set -euo pipefail
cd /var/app/current

test -f prisma/schema.prisma
test -d prisma/migrations
test -x node_modules/.bin/prisma
test -f package-lock.json
test -f docs/NoLSAF_Sales_Partner_Agreement.md
test -f docs/NoLSAF_Sales_Partner_Agreement.fields.json
test -f docs/NoLSAF_Operator_Mutual_NDA.md
test -f docs/NoLSAF_Operator_Mutual_NDA.fields.json

find prisma/migrations -name migration.sql -type f | wc -l
test "$(find dist/src -name '*.js' -type f | wc -l)" \
  -eq "$(find dist/src -name '*.js.map' -type f | wc -l)"
test ! -d dist/src/__tests__
test ! -d dist/src/dev
```

The migration count must match the local migration count from the QA step. The
JavaScript and source-map counts must match, and test/development output must be
absent. If any required artifact is missing, exit and redeploy with
`scripts/deploy-eb.ps1`.

### Private production error symbolication

The API bundle contains `dist/release.json`, generated from the exact Git commit
and repository remote during the build. API JavaScript source maps remain
adjacent to compiled files inside the private EB bundle. Browser source maps are
removed from public Next.js assets and uploaded by the Vercel production build
to a private S3 prefix keyed by the same Git commit.

Elastic Beanstalk requires these non-secret settings:

```text
SOURCE_MAP_BUCKET=<private bucket name>
SOURCE_MAP_AWS_REGION=eu-north-1
SOURCE_MAP_S3_PREFIX=source-maps
```

Its instance profile must have `s3:GetObject` only for
`arn:aws:s3:::<bucket>/source-maps/*`.

Vercel production builds require:

```text
SOURCE_MAP_UPLOAD_BUCKET=<private bucket name>
SOURCE_MAP_AWS_REGION=eu-north-1
SOURCE_MAP_S3_PREFIX=source-maps
SOURCE_MAP_UPLOAD_REQUIRED=true
SOURCE_MAP_AWS_ROLE_ARN=<Vercel production OIDC upload role ARN>
```

The Vercel role uses OIDC federation and short-lived credentials. Do not create
or store an IAM access key in Vercel. Its role may only call `s3:PutObject` under
the private `source-maps/*` prefix. The bucket must block all public access and
retain server-side encryption.

When an error is captured, the diagnostic service uses its release SHA and
generated chunk path to retrieve the matching private map, then emits the
original TypeScript file, line, bounded code context, fingerprint, and immutable
GitHub commit link. Source-map retrieval is outside normal request handling and
fails closed when storage is unavailable.

Load the production URL without printing it. Prisma's schema engine does not
use the API's MariaDB driver TLS settings, so also download the official AWS RDS
CA bundle and append strict TLS settings only to the temporary CLI URL:

```bash
export DATABASE_URL="$(/opt/elasticbeanstalk/bin/get-config environment -k DATABASE_URL)"
test -n "$DATABASE_URL"

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /tmp/rds-global-bundle.pem
test -s /tmp/rds-global-bundle.pem

case "$DATABASE_URL" in
  *\?*) export DATABASE_URL="${DATABASE_URL}&sslcert=/tmp/rds-global-bundle.pem&sslaccept=strict" ;;
  *) export DATABASE_URL="${DATABASE_URL}?sslcert=/tmp/rds-global-bundle.pem&sslaccept=strict" ;;
esac

cat >/tmp/prisma-production.config.cjs <<'EOF'
const { defineConfig } = require('/var/app/current/node_modules/prisma/config');

module.exports = defineConfig({
  schema: '/var/app/current/prisma/schema.prisma',
  migrations: {
    path: '/var/app/current/prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
EOF
```

Verify the deployed bundle and production migration history still agree:

```bash
./node_modules/.bin/prisma migrate status \
  --config /tmp/prisma-production.config.cjs
```

Required result is:

```text
Database schema is up to date!
```

A pending or failed migration here means the deployed bundle and the section 6
runner did not use the same artifact. Stop and investigate; do not apply a
required migration for the first time after dependent API code is running.

Clean the temporary configuration and leave SSH:

```bash
rm -f /tmp/prisma-production.config.cjs /tmp/rds-global-bundle.pem
exit
```

## 9. Verify production after migration and deployment

Back in PowerShell:

```powershell
Set-Location $ApiDir
& $Eb status

$Health = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "https://api.nolsaf.com/health" `
  -TimeoutSec 30

$Health.StatusCode
$Health.Content
```

Required final state:

- EB status is `Ready`.
- EB health is `Green`.
- Health endpoint returns HTTP `200` and reports production.
- Prisma reported `Database schema is up to date!`.

Confirm the repository was restored after packaging:

```powershell
Set-Location $RepoRoot
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Git status must be empty and the two commit hashes must match.

Do not repeat feature QA or execute functional test suites against production.
The feature behavior has already been accepted on the exact staging commit.
Limit post-deployment production verification to health/readiness, migration
status, observability, and pre-approved read-only canary requests that cannot
create or mutate business data. Monitor EB events and application logs
immediately after the release:

```powershell
Set-Location $ApiDir
& $Eb events $EbEnvironment
& $Eb logs $EbEnvironment --all
```

The wrapper exposes the same read-only views as
`.\scripts\aws-production.ps1 status`, `events`, `logs`, and `health`.

## 10. Record the release

Use
[`docs/RELEASE_EVIDENCE_TEMPLATE.md`](docs/RELEASE_EVIDENCE_TEMPLATE.md).

Record these values in the release ticket or deployment log:

- Git commit SHA.
- EB application version.
- RDS snapshot identifier.
- Number of Prisma migrations.
- QA/check results.
- Deployment time and operator.
- Final EB and API health status.

Keep the pre-migration snapshot according to the production backup-retention
policy. Do not delete it immediately after deployment.

## Failed Prisma migration procedure

For the known immutable case-sensitive migrations beginning with
`20260822170000_add_user_registration_lifecycle`, use the guarded, clone-first
procedure in
[`docs/CASE_SENSITIVE_DATABASE_RECOVERY.md`](docs/CASE_SENSITIVE_DATABASE_RECOVERY.md).
Do not substitute an ad-hoc SQL session or edit the shared migrations.

A failed MariaDB migration can be partially applied because many DDL statements
automatically commit. Never assume that a failed migration changed nothing.

If Prisma returns `P3009`, `P3018`, or reports a failed migration:

1. Stop the release. Do not repeatedly run `migrate deploy`.
2. Confirm the API remains healthy and record the failed migration name.
3. Preserve the pre-migration RDS snapshot.
4. Inspect the failed SQL and the live schema to determine which statements
   already committed.
5. Check affected tables for orphaned rows before adding foreign keys.
6. Make reconciliation SQL restart-safe where MariaDB supports it.
7. Test the entire migration chain on a database restored from the production
   snapshot.
8. Only after the live schema is understood and repaired, mark the failed
   migration rolled back:

```bash
./node_modules/.bin/prisma migrate resolve \
  --rolled-back <failed_migration_name> \
  --config /tmp/prisma-production.config.cjs
```

9. Run `migrate deploy`, then `migrate status`.
10. Verify EB health, API health, critical columns, foreign keys, and migration
    history.

Do not use `migrate resolve --applied` unless every statement and required data
change from that migration is already present and independently verified.

## Snapshot-clone validation for high-risk migrations

Use a temporary clone for large drift reconciliations, destructive migrations,
or recovery from a partially applied migration.

Create the clone from the verified snapshot:

```powershell
$CloneId = "database-1-migration-test-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

aws rds restore-db-instance-from-db-snapshot `
  --region $AwsRegion `
  --db-instance-identifier $CloneId `
  --db-snapshot-identifier $SnapshotId `
  --db-instance-class db.t4g.micro `
  --no-publicly-accessible

aws rds wait db-instance-available `
  --region $AwsRegion `
  --db-instance-identifier $CloneId

aws rds describe-db-instances `
  --region $AwsRegion `
  --db-instance-identifier $CloneId `
  --query "DBInstances[0].[DBInstanceIdentifier,DBInstanceStatus,Endpoint.Address,DBName,EngineVersion]"
```

Use a separate temporary connection URL for the clone. Never change the
production EB `DATABASE_URL` to the clone. Apply and verify the complete
migration chain against the clone using the same Prisma commands as production.

After production is healthy, verify the exact clone identifier before deletion:

```powershell
aws rds describe-db-instances `
  --region $AwsRegion `
  --db-instance-identifier $CloneId `
  --query "DBInstances[0].[DBInstanceIdentifier,DBInstanceStatus,DBInstanceClass,Engine]"
```

Delete only the confirmed temporary clone:

```powershell
aws rds delete-db-instance `
  --region $AwsRegion `
  --db-instance-identifier $CloneId `
  --skip-final-snapshot `
  --delete-automated-backups
```

This deletion is irreversible unless another snapshot exists. Never substitute
`database-1` for `$CloneId`.

## Application rollback

An application rollback does not undo database migrations. Prefer compatible,
forward-only database fixes.

To redeploy the previously recorded EB application version:

```powershell
Set-Location $ApiDir
& $Eb deploy $EbEnvironment --version <previous_application_version>
& $Eb status
```

If database restoration is required, stop normal deployment work and open an
incident. Restoring an RDS snapshot creates a separate database instance; it
does not safely overwrite production:

```powershell
$RestoreId = "database-1-emergency-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

aws rds restore-db-instance-from-db-snapshot `
  --region $AwsRegion `
  --db-instance-identifier $RestoreId `
  --db-snapshot-identifier $SnapshotId
```

Do not switch production traffic or change `DATABASE_URL` until the restored
database has been validated and an explicit recovery decision has been made.

## Common failure checks

### Git cannot create `index.lock`

First confirm no Git operation, editor Git integration, or deployment process is
running. Then inspect the lock from the repository root:

```powershell
Set-Location $RepoRoot
Get-Item "$RepoRoot\.git\index.lock" -ErrorAction SilentlyContinue
Get-Process git -ErrorAction SilentlyContinue
```

Remove a stale lock only after confirming no Git process is active.

### Deployment script temporary path already exists

Do not immediately delete it. Confirm no deployment process is running:

```powershell
Get-Process eb,powershell -ErrorAction SilentlyContinue
git status --short
```

The deployment script normally restores `package.json` and removes
`apps/api/_workspace`, `apps/api/prisma`, `apps/api/docs`,
`apps/api/package-lock.json`, and `apps/api/package.json.predeploy-bak` in its
`finally` block.

### EB deploy fails

```powershell
Set-Location $ApiDir
& $Eb status
& $Eb events $EbEnvironment
& $Eb logs $EbEnvironment --all
```

The useful cause is normally earlier in `eb-engine.log`; the final
`Engine execution has encountered an error` message is only a summary.

### API is `Ready` but health is Yellow or Red

```powershell
& $Eb health $EbEnvironment
& $Eb logs $EbEnvironment --all
```

Check application startup, required environment variables, port `8080`, RDS
connectivity, and health endpoint responses. Do not migrate while health is Red.

### MariaDB error 1030: `Operation not permitted` from InnoDB

This can be an unusable index even when `CHECK TABLE` reports `OK`. It is not an
HTTP TLS or SSL-certificate failure.

The July 2026 incident was caused by case-only index renames. MariaDB accepted
the migration and exposed the renamed indexes in `information_schema`, but some
of those indexes failed whenever the optimizer selected them. The repair is the
forward-only migration
`20260728230000_rebuild_unusable_case_renamed_indexes`.

Before repairing an index:

1. Use `EXPLAIN` to identify the index selected by the failing query.
2. Reproduce the failure with a read-only `SELECT ... FORCE INDEX (...)`.
3. Compare the live index columns and uniqueness with
   `information_schema.STATISTICS`.
4. Create and verify a fresh RDS snapshot.
5. Add a new migration that drops and recreates the same index using separate
   `ALTER TABLE ... DROP INDEX` and `ALTER TABLE ... ADD INDEX` statements.
   MariaDB can optimize a drop/add pair in one `ALTER TABLE` without physically
   rebuilding the index. If the target index supports a foreign key, create a
   temporary compatible index before the drop and remove it only after the
   rebuilt index exists. Never edit an already-applied migration.
6. Use the snapshot-clone procedure above when the affected tables are large.
7. Apply the repair with the normal `prisma migrate deploy` procedure.
8. Repeat the forced-index read and production endpoint checks.

Useful read-only metadata query:

```sql
SELECT
  TABLE_NAME,
  INDEX_NAME,
  NON_UNIQUE,
  SEQ_IN_INDEX,
  COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = '<table>'
  AND INDEX_NAME = '<index>'
ORDER BY SEQ_IN_INDEX;
```

Do not use `prisma db push`, delete application records, or restore the whole
database to repair one unusable index.

### Platform-version warning

The warning does not necessarily mean the application deployment failed. Plan
the recommended Node.js platform upgrade as a separate maintenance change:

1. Confirm application compatibility.
2. Create an RDS snapshot.
3. Upgrade a clone or non-production environment first.
4. Deploy and smoke-test.
5. Upgrade production during a monitored maintenance window.

Do not combine an EB platform upgrade with a large application/database release.

## One-time environment requirements

- AWS CLI is authenticated for the correct production account.
- EB CLI is installed and configured for `eu-north-1`.
- EB application is `nolsaf-api`.
- EB environment is `nolsaf-api-production-alb`.
- SSH key access to the EB instance works.
- EB and RDS security groups allow the API to reach MariaDB on port `3306`.
- Production environment variables are configured securely in AWS.
- The API listens on `process.env.PORT`.
- The `/health` endpoint is configured as the health check.

Never store production secrets in an `env.yaml` file committed to Git. Use the
Elastic Beanstalk environment configuration, AWS-managed secret storage, or an
approved secure operator workflow.
