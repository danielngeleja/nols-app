# Branch Strategy - Two Truths, One Native Trunk

This branch map is subordinate to the authoritative
[`ENGINEERING_DELIVERY_POLICY.md`](ENGINEERING_DELIVERY_POLICY.md), which defines
environment boundaries, Prisma coupling, qualification, and release order.

This repository is a monorepo. There are exactly two long lived development branches,
each the single source of truth for one concern:

- `staging` owns the backend and web (`apps/api`, `apps/web`, `apps/public`,
  `packages/shared`, `packages/prisma`, `prisma/`, and root deploy config).
- `nolsaf/integration` owns all native work (`apps/mobile`, `apps/driver`,
  `apps/partners`, and the shared UI package `packages/native-ui`).

`main` is the production release branch. Everything else is a backup or a release
pointer, not a place to develop.

## Why one native trunk, not a branch per app

The three native apps share `packages/native-ui` (and the root `package.json`, the
lockfile, and the Metro config). When each app had its own long lived branch, every
branch carried its own copy of the shared package and root config, and they drifted
and collided on every merge. A shared package can only have one canonical copy, which
means one branch. So all native development happens on `nolsaf/integration`.

This does not mix the apps together. They stay isolated **by folder**, which is
stronger than isolating by branch:

```text
apps/mobile/        customer app    (only customer code)
apps/driver/        driver app      (only driver code)
apps/partners/      partners app    (only partners code)
packages/native-ui/ shared UI       (used by all three)
```

A change is "app only" or "shared" based on which folder it touches, not which branch
you are on.

## The broad workspace and lean deploys

The root workspace list is intentionally broad:

```json
"workspaces": ["apps/*", "packages/*"]
```

That lets the native apps link `@nolsaf/native-ui` through normal workspace resolution,
with no forked copies. Backend deploys stay lean even with the broad list, because the
API and web Docker images install only the workspaces they need
(`npm ci --include-workspace-root --workspace=@nolsaf/api ...`) and `.dockerignore`
keeps the native apps out of those images. Deployment isolation lives in the deploy
layer, never in a narrowed workspace list. Do not narrow `workspaces` to fix a deploy;
that breaks native shared package linking. Fix deploy scope in the Dockerfiles instead.

## `main` - Production

- Production release branch.
- `apps/web` deploys to the production Vercel project.
- `apps/api` runs on the production AWS API environment and production database.
- Native apps are not deployed from `main`; native production builds are cut by EAS
  from a tagged commit on `nolsaf/integration`.
- Only merge tested work from `staging` into `main`.

## `staging` - Backend and Web Truth

`staging` owns anything that can affect more than one product surface at the API, web,
or runtime level:

- `apps/api`, `apps/web`, `apps/public`
- deployable shared packages such as `packages/shared` and `packages/prisma`
- `prisma/`
- root config such as `package.json`, TypeScript, lint, build, and deployment config
- the staging version of `package-lock.json` used by backend and web builds
- shared contracts for auth, booking, payments, pricing, availability, rides, payouts,
  notifications, and user data

### QA ownership and production boundary

- All integration QA, functional testing, authenticated browser testing, migration
  rehearsal, schema-drift checks, seed/test data, load testing, and release acceptance
  belong on `staging` or a disposable restored production snapshot.
- A change is not eligible for `main` until the exact staging commit has passed the
  required CI, database, API, web, responsive UI, and regression checks and has
  explicit QA approval.
- AWS Elastic Beanstalk and production RDS are deployment targets only. Do not run
  functional suites, test generators, load tests, schema experiments,
  `prisma migrate dev`, or `prisma db push` against production.
- Production checks are limited to health/readiness, observability, migration status,
  and narrowly scoped read-only canaries. Unexpected results trigger a stop or
  rollback, not exploratory testing on production.

When API behavior, database schema, or a deployable shared package changes, commit it
to `staging` first, then merge `staging` into `nolsaf/integration` so native picks it up.

### Shared lockfile rule

`package-lock.json` is a branch-local generated coordination artifact because both
truth branches use the same npm workspace while owning different package manifests.

- Commit backend, web, Prisma, shared-package, and root dependency lockfile changes on
  `staging`.
- Commit lockfile changes caused by `apps/mobile`, `apps/driver`, `apps/partners`, or
  `packages/native-ui` dependency changes on `nolsaf/integration`.
- After merging `staging` into `nolsaf/integration`, resolve package manifests first,
  then regenerate `package-lock.json` on `nolsaf/integration` with
  `npm install --package-lock-only`. Never resolve the lockfile by hand.

Each branch therefore keeps a lockfile that matches the manifests it actually builds:
staging for backend/web deployment and integration for EAS/native builds.

## `nolsaf/integration` - Native Truth

The single branch for all native development: the customer app, the driver app, the
partners app, and the shared `packages/native-ui`. There is one canonical copy of the
shared package here, so it cannot drift.

- Pulls API, package, and shared contract updates from `staging` (merge `staging` in).
- All native commits land here, routed by folder (see below).
- Native release builds are cut from here per app via EAS.

## Daily git commands (the only workflow you need)

Two rules that keep this safe:

1. Never run `git add -A` or `git add .` in this repo. There are untracked build
   artifacts (`apps/mobile/node_modules`, `.expo`, `dist`, `.env.local`). Always stage
   the exact folder you changed, for example `git add packages/native-ui` or
   `git add apps/driver`.
2. The commit prefix is the blast radius. `feat(native-ui):` means a shared change you
   verified across all apps. `feat(driver):` means driver only. Keep history honest
   about what each commit affects.

### Start every session

```bash
git checkout nolsaf/integration
git pull origin nolsaf/integration      # get the latest before editing
```

### Change one app only (driver, partners, or customer)

The folder isolates it, so no cross app check is needed:

```bash
# edit files under apps/driver/  (or apps/partners/ , apps/mobile/)
( cd apps/driver && npx tsc --noEmit )      # typecheck just that app
( cd apps/driver && npx expo start )        # optional: run just that app

git add apps/driver                         # stage only that folder
git commit -m "feat(driver): what changed"
git push origin nolsaf/integration
```

The commit touches only `apps/driver/**`, so `apps/mobile` and `apps/partners` are
untouched.

### Change the shared UI (`packages/native-ui`)

A native-ui change affects all three apps, so verify every consumer compiles before
committing. This is the drift guard:

```bash
# edit files under packages/native-ui/src/...

npm --workspace=@nolsaf/native-ui run typecheck
( cd apps/partners && npx tsc --noEmit )
( cd apps/mobile   && npx tsc --noEmit )
( cd apps/driver   && npx tsc --noEmit )

git add packages/native-ui                  # plus any app files you changed to match
git commit -m "feat(native-ui): what changed"
git push origin nolsaf/integration
```

### Pull backend or web updates from staging

When the API, database, or shared contracts change on `staging`:

```bash
git checkout nolsaf/integration
git merge origin/staging                    # bring API/web/contract updates into native
git push origin nolsaf/integration
```

### Release one app independently

Each app keeps its own `app.json`, bundle id, and `eas.json`, so they ship separately
even though they share a tree:

```bash
cd apps/partners && eas build --profile production   # or apps/driver, apps/mobile
```

Choose which app to build and submit. Sharing a branch does not force them to ship
together.

## Legacy per app branches (backups only)

`nolsaf-native-expo`, `nolsaf-driver-expo`, and `nolsaf-partners-expo` are the old per
app development branches. Their work is already merged into `nolsaf/integration`. They
are kept as backups and historical reference only. Do not develop on them; new native
work goes on `nolsaf/integration`. They may be deleted once `nolsaf/integration` is
confirmed and pushed.

## Commit Routing

| Change type | Branch |
| --- | --- |
| API behavior, database, payment/auth/booking logic | `staging` |
| Web UI or Vercel-facing web changes | `staging` |
| Deployable shared packages or root deployment config | `staging` |
| Lockfile generated by backend/web/root dependency changes | `staging` |
| Lockfile generated by native app or `native-ui` dependency changes | `nolsaf/integration` |
| Shared native UI (`packages/native-ui`) | `nolsaf/integration` |
| Customer app only (`apps/mobile`) | `nolsaf/integration` |
| Driver app only (`apps/driver`) | `nolsaf/integration` |
| Partner app only (`apps/partners`) | `nolsaf/integration` |

## Sync Flow

1. Commit shared backend or web work to `staging`.
2. Verify API, web, and shared package checks on `staging`.
3. Merge `staging` into `nolsaf/integration` so native has the latest contracts.
4. Commit native work on `nolsaf/integration`, routed by folder.
5. Cut per app native builds from `nolsaf/integration` via EAS.
6. Merge tested `staging` into `main` for backend and web production releases.

This keeps `staging` as the backend and web truth, `nolsaf/integration` as the native
truth with one canonical shared UI package, and each app isolated by its own folder.
