# Quick Start: Staging-First Release Flow

This repository uses `staging` as the single shared integration and QA source of
truth. `main` is reserved for code that has already passed staging QA and is
approved for production.

## Environment boundary

| Environment | Branch | Purpose |
| --- | --- | --- |
| Local/disposable | Feature branch | Development and focused checks |
| Staging | `staging` | Integration, functional QA, authenticated workflows, responsive UI, regression, migrations, and release acceptance |
| Production | `main` | Deployment of approved staging commits only |

AWS Elastic Beanstalk and production RDS are deployment targets, not test
environments. Never run test suites, test-data generators, seed scripts, load
tests, schema experiments, `prisma migrate dev`, or `prisma db push` against
production.

## 1. Integrate completed work into staging

Commit only the intended files on a feature branch, review the staged diff, and
push the feature branch:

```powershell
git status --short
git add -- <reviewed-files>
git diff --cached
git commit -m "Describe the completed change"
git push -u origin <feature-branch>
```

Merge the reviewed feature commit into `staging` using the repository's normal
review process. Never force-push the shared staging branch.

## 2. Validate the exact staging commit

Start from a clean staging checkout:

```powershell
git switch staging
git pull --ff-only origin staging
git status --short
```

The status must be empty. Run the required release checks:

```powershell
npm ci
npm run lint
npm run typecheck
npm --workspace=@nolsaf/api test
npm run build
```

When Prisma changes, also run the immutable migration and schema checks:

```powershell
npm run migrations:checksums
npm run migrations:coverage
npm run schema:check:staging
npm run schema:check:clone
npm run migration:validate:reconciliation
```

Database-dependent and functional testing must use the isolated staging
database or a disposable/restored production snapshot clone. Record the exact
staging commit SHA and the QA results.

## 3. Staging QA approval

The exact staging commit must pass:

- CI, lint, typecheck, API tests, and builds;
- API and authenticated workflow checks;
- responsive web UI checks on supported screen sizes;
- migration rehearsal and physical schema checks when Prisma changes;
- regression testing for affected product areas;
- Redis/worker validation when background processing changes;
- explicit QA and release approval.

Any failure remains a staging issue. Fix it on a feature branch, integrate it
into `staging`, and repeat the affected checks. Do not troubleshoot by testing
the change against AWS production.

## 4. Promote staging to main

Only after staging approval:

```powershell
git switch staging
git pull --ff-only origin staging
git status --short

git switch main
git pull --ff-only origin main
git merge --no-ff staging -m "release: promote staging to production"
```

Run the critical release checks again on the exact merge commit. Push `main`
only when the checkout is clean and every required check passes.

## 5. Deploy production

Follow the authoritative AWS runbook:

- [`nolsaf/API_DEPLOYMENT_GUIDE.md`](nolsaf/API_DEPLOYMENT_GUIDE.md)
- [`nolsaf/docs/PRODUCTION_STABILITY_RUNBOOK.md`](nolsaf/docs/PRODUCTION_STABILITY_RUNBOOK.md)

Production verification is limited to health/readiness, migration status,
observability, and pre-approved read-only canary requests. Do not run feature
QA, generated tests, load tests, or schema experiments on AWS production.

## Stop conditions

Stop promotion or deployment when:

- staging CI, QA, builds, or migration checks are incomplete or failing;
- the exact staging commit was not approved;
- the working tree is dirty or branch SHAs are not the expected values;
- staging or snapshot-clone physical schema checks report drift;
- a migration was edited after being shared or applied;
- a production snapshot is required but not verified;
- production health is not green and ready;
- any command would point testing or test data at AWS production.
