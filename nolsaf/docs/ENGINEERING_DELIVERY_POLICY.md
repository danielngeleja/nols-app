# NoLSAF engineering delivery policy

Status: authoritative. This policy governs every NoLSAF code, Prisma, staging,
release, deployment, and incident-recovery change. A product plan, task note,
README example, or historical incident record cannot override it.

## 1. One delivery path

Every change follows one direction:

```text
feature branch
  -> local/disposable validation
  -> reviewed commit
  -> staging integration
  -> staging QA and physical-schema verification
  -> restored production-snapshot clone qualification when Prisma changes
  -> exact staging commit promoted to main
  -> verified production recovery point
  -> schema migration from the exact main commit
  -> dependent API/web deployment
  -> production health and observability checks
```

Do not skip forward, test backward against production, or repair one environment
by editing history that another environment has already recorded.

## 2. Authority and documentation hierarchy

1. This policy defines mandatory boundaries and release order.
2. `docs/PRODUCTION_STABILITY_RUNBOOK.md` defines stability gates.
3. `API_DEPLOYMENT_GUIDE.md` defines executable AWS production steps.
4. `docs/AIVEN_STAGING.md` defines executable staging database steps.
5. `docs/BRANCHING.md` defines branch ownership.
6. Product specifications and incident records provide context only. Their
   historical status statements are not deployment instructions.
7. README and operations examples must link here and may not define a competing
   release path.

If documents conflict, stop and correct them before continuing the release.

## 3. Environment boundaries

| Phase | Branch or artifact | Database | Allowed work |
| --- | --- | --- | --- |
| Development | Feature branch | Local disposable | Implementation, focused tests, destructive experiments |
| Integration | `staging` | Isolated Aiven staging | Full QA, authenticated workflows, migration application |
| Qualification | Exact staging commit | Disposable restored production snapshot | Migration rehearsal, data preflights, physical diff |
| Release | `main` matching `origin/main` | Production RDS | Approved migration and deployment only |
| Incident recovery | Forward repair branch | Clone first | Diagnosis, reproduction, forward-only repair |

Production is never a development, QA, load-test, seed, generated-test, schema
experiment, or exploratory debugging target. A production mutation always needs
fresh explicit approval for that exact action.

## 4. Repository and worktree discipline

- Record the absolute repository path, branch, HEAD, upstream SHA, and clean
  status at the start of an operation.
- Use one canonical checkout for a release. Do not combine edits or command
  output from different worktrees as if they were one tree.
- Preserve unrelated user changes. If the canonical checkout is dirty, stop or
  isolate the intended work before switching or merging.
- Feature work is committed on a feature branch and integrated into `staging`.
  `main` receives only the exact staging commit that passed all required gates.
- Never force-push `staging` or `main` and never create empty release commits.

## 5. Definition of done for every change

A change is not complete because it works in one browser or one existing
database. Before staging integration it must have:

- reviewed source diff with no unrelated files;
- focused tests for the affected behavior;
- lint, typecheck, relevant test suites, and builds passing;
- security and tenancy boundaries reviewed when applicable;
- documentation updated when behavior or operations change;
- no secret, database URL, token, private key, or production data in Git or logs.

Warnings that affect correctness, reproducibility, security, or deployment are
release failures, not cosmetic output.

## 6. Prisma change definition of done

Treat these as one indivisible change:

- `prisma/schema.prisma`;
- exactly one or more new forward-only migration directories;
- `prisma/migration-checksums.json`;
- application compatibility and tests;
- operational documentation when deployment behavior changes.

Required development sequence:

1. Start from the latest validated `staging` schema and migration head.
2. Change `prisma/schema.prisma`.
3. Create a new timestamped forward migration. Never edit, rename, reorder, or
   delete a migration shared with another developer or applied to any shared
   database.
4. Review the SQL for destructive operations, data preservation, retry safety,
   referential actions, orphan rows, indexes, locking, and MariaDB support.
5. Update the checksum manifest only after reviewing the new SQL:

   ```powershell
   npm run migrations:checksums:update
   ```

6. Run the local integrity gates:

   ```powershell
   npm run migrations:checksums
   npm run migrations:coverage
   npm run migration:validate:reconciliation
   ```

7. Apply the migration to a fresh disposable database or approved baseline and
   require a zero Prisma physical-schema diff.
8. Commit schema, migration, manifest, compatibility code, and tests together.
9. Apply the exact committed migration head to staging with the guarded staging
   command. Require checksum agreement, migration status, physical diff, and
   functional QA.
10. Restore a fresh production snapshot clone for every production-bound Prisma
    change. Apply the exact staging migration head and require data preflights,
    checksum agreement, migration status, and zero physical diff.
11. Promote only that exact staging commit to `main`.

`prisma db push`, `prisma migrate dev`, `prisma migrate reset`, and Prisma Studio
are local-disposable tools only. Human operators must use the guarded staging
commands for Aiven and the designated migration runner for production.

## 7. Application/schema compatibility

No application release may require a schema that has not been verified present.

Use expand-and-contract:

1. Expand with backward-compatible tables, columns, indexes, or constraints.
2. Apply and verify the expansion before deploying code that depends on it.
3. Deploy compatible application code and enable behavior only after readiness.
4. Backfill and observe separately when required.
5. Remove old fields or behavior only in a later independently qualified
   release.

A generated Prisma client can select newly declared scalar fields even when old
business logic does not mention them. Therefore “the code does not use the new
field yet” is not sufficient proof of backward compatibility.

If the current deployment tooling cannot run the exact migration artifact
before starting dependent code, the release is blocked until a migration-only
runner or a separate compatible release is available.

## 8. Staging qualification

Staging is the shared integration truth. For the exact candidate SHA:

- the working tree is clean and equals `origin/staging`;
- CI, lint, typecheck, API tests, builds, and affected UI checks pass;
- guarded migration status reports no failed history;
- migration checksums agree;
- schema-to-migration coverage reports nothing missing;
- physical schema diff is zero;
- authenticated and database-dependent tests use staging data only;
- QA approval and results are recorded against the SHA.

A later commit invalidates the earlier approval and must rerun affected gates.

## 9. Production-snapshot clone qualification

For every production-bound Prisma change:

1. Obtain explicit authorization to create and later delete the disposable
   clone.
2. Record source snapshot identifier and timestamp.
3. Restore the clone privately in the production network shape.
4. Run preflight queries for duplicates, orphans, nullability, destructive
   conversions, and migration-specific invariants.
5. Apply the exact candidate migration artifact.
6. Require checksum agreement, migration status, and zero physical diff.
7. Run functional tests only on staging or the clone, never production.
8. Record results and delete only the explicitly named disposable clone.

A clone mismatch is a staging issue. Create another forward migration and repeat
qualification; never edit an applied migration or manufacture migration history.

## 10. Production release order

Fresh explicit production approval is required. The order is:

1. Verify clean `main` equals `origin/main` and is the approved staging SHA.
2. Confirm all staging and clone evidence belongs to that SHA.
3. Verify current API health, Redis/worker topology, and rollback ownership.
4. Create and verify the production RDS recovery snapshot.
5. Validate the API bundle without deploying it.
6. From one designated runner, apply the exact `main` migration artifact before
   deploying application code that depends on it.
7. Verify migration status and required physical objects.
8. Deploy the API/web artifacts from the same SHA.
9. Verify health, readiness, observability, worker lease ownership, and error
   rates. Production checks are read-only unless separately approved.
10. Record the release evidence.

Application-only releases omit steps 4, 6, and 7 only when the exact diff proves
there is no Prisma schema, migration, or database-dependent compatibility change.

## 11. Incident and failed-migration path

On a Prisma error, migration failure, unexpected physical diff, crash, or 5xx:

1. Stop the release and preserve logs and the recovery point.
2. Do not repeatedly run deploy, use `db push`, or edit the failed migration.
3. Determine which DDL statements committed; MariaDB DDL may auto-commit.
4. Reproduce on staging or a fresh snapshot clone.
5. Check data invariants before adding constraints or converting columns.
6. Create a guarded forward-only reconciliation migration.
7. Repeat local, staging, and clone qualification.
8. Use `prisma migrate resolve` only after physical state and data effects are
   independently proven and the exact recovery action is approved.

## 12. Automated enforcement

CI must reject:

- modifications to migrations present on the base revision;
- schema objects without migration coverage;
- missing or changed checksums;
- failed disposable reconciliation;
- lint, typecheck, test, or build failures.

Release automation must additionally reject a dirty tree, wrong branch or SHA,
missing clone evidence for Prisma changes, non-zero physical diff, missing
recovery point, or application deployment before required schema readiness.
Markdown describes the control; automation must fail closed wherever possible.

`scripts/aws-production.ps1` currently enforces only the deployment-time subset:
a clean working tree, `main` matching `origin/main`, an explicit production
confirmation, and an explicit database-change state. Clone evidence, physical
diff, recovery point, and migration readiness remain operator-attested through
the runbook and the release record. Do not treat a successful wrapper run as
evidence that those gates were satisfied.

## 13. Required release record

Use [`RELEASE_EVIDENCE_TEMPLATE.md`](RELEASE_EVIDENCE_TEMPLATE.md) in the
approved release ticket or dated release record. Record at minimum:

- feature, staging, and main commit SHAs;
- migration head and migration names;
- checksum, coverage, staging physical diff, and clone physical diff results;
- staging QA result and approver;
- production snapshot and disposable clone identifiers;
- migration runner, start/end time, and output summary;
- deployed EB/Vercel artifact versions;
- final health/readiness and rollback owner.

## 14. Stop conditions and exceptions

Stop when any required evidence is missing, any target is ambiguous, branches or
artifacts differ, a shared migration changed, schema diff is non-zero, production
health is not ready, or the requested action exceeds current authorization.

An emergency does not permit rewriting migration history or testing on
production. Any exception must name its scope, approver, recovery plan, expiry,
and follow-up action in the release or incident record.
