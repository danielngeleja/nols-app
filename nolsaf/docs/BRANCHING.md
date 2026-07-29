# Branch Strategy - Shared Core and App Branches

This repository is a monorepo. The root workspace list is intentionally explicit
so API/web deploys do not install native-only apps or packages.

The important rule is simple:

- Shared code is integrated through `staging`.
- App-only code stays on that app's branch.
- `main` is for production-ready releases.

## `main` - Production

- Production release branch.
- `apps/web` is deployed to the production Vercel project.
- `apps/api` runs on the production AWS API environment and production database.
- Only merge tested work from `staging` into `main`.

## `staging` - Shared Integration

`staging` is the shared truth branch for API, web, database, and deployable shared
contracts. It owns anything that can affect more than one product surface at the
API/web/runtime level:

- `apps/api`
- `apps/web`
- deployable shared packages such as `packages/shared` and `packages/prisma`
- `prisma/`
- root workspace files such as `package.json`, `package-lock.json`, TypeScript,
  lint, build, and deployment config
- shared contracts for auth, booking, payments, pricing, availability, rides,
  payouts, notifications, and user data

### QA ownership and production boundary

- All integration QA, functional testing, authenticated browser testing,
  migration rehearsal, schema-drift checks, seed/test data, load testing, and
  release acceptance belong on `staging` or a disposable/restored production
  snapshot clone.
- A change is not eligible for `main` until the exact staging commit has passed
  the required CI, database, API, web, responsive UI, and regression checks and
  has explicit QA approval.
- AWS Elastic Beanstalk and production RDS are deployment targets only. Do not
  run functional suites, test generators, load tests, schema experiments,
  `prisma migrate dev`, or `prisma db push` against production.
- After deployment, production checks are limited to health/readiness,
  observability, migration status, and narrowly scoped read-only canaries.
  Unexpected results trigger a stop or rollback; they do not start exploratory
  testing on production.

When API behavior, database schema, or deployable shared package behavior changes,
commit it to `staging` first. Then merge or rebase `staging` into the app branch
that needs the change.

Native-only shared UI packages, such as `packages/native-ui`, must not be installed
by API/web deploys. They may live on native app branches and should be synced only
to the native branches that need them.

Because the root workspace list is deployment-sensitive, native branch syncs should
not blindly take `staging`'s `package.json` if that would remove `apps/mobile`,
`apps/driver`, or native-only shared packages from local tooling.

## `nolsaf-native-expo` - Customer Mobile App

- Owns customer mobile work in `apps/mobile`.
- Uses EAS for Android/iOS builds.
- Pulls API, package, payment, auth, and contract updates from `staging`.
- Should not hide API or shared package changes inside mobile-only commits.

## `nolsaf-driver-expo` - Driver Mobile App

- Owns driver app work in `apps/driver`.
- Uses EAS for Android/iOS builds.
- Pulls shared UI, API, auth, ride, payout, and notification contracts from
  `staging`.
- Driver-only screens, navigation, assets, and app config belong here.

## Future `nolsaf-partners-expo` - Partner Mobile App

- Will own partner app work in `apps/partners`.
- Pulls shared contracts and packages from `staging`.
- Partner-only screens, navigation, assets, and app config belong there.

## Commit Routing

Use this routing before every commit:

| Change type | Branch |
| --- | --- |
| API behavior, database, payment/auth/booking logic | `staging` |
| Web UI or Vercel-facing web changes | `staging` |
| API/web shared packages or root deployment config | `staging` |
| Native-only shared UI packages | Native app branches that need them |
| Customer mobile only | `nolsaf-native-expo` |
| Driver app only | `nolsaf-driver-expo` |
| Partner app only | `nolsaf-partners-expo` |

## Sync Flow

1. Commit shared work to `staging`.
2. Verify API/web/shared package checks on `staging`.
3. Merge or rebase `staging` into app branches that need the shared work.
4. Commit app-only work on the app branch.
5. Merge tested `staging` into `main` for production releases.

This keeps `staging` as the tree that holds shared behavior, while each app
branch stays focused on its own product surface.
