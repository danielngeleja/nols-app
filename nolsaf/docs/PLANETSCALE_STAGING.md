# PlanetScale Staging Setup

This project already uses Prisma with the MySQL provider, so PlanetScale can be used for the staging database without changing the app to Postgres.

## Recommended Staging Shape

```text
Vercel staging/preview web
  -> Render staging API
    -> PlanetScale staging database/branch
```

Do not point staging at the production database.

## PlanetScale Setup

1. Create a PlanetScale database for staging, for example `nolsaf-staging`.
2. Enable **Foreign key constraints** in the PlanetScale database settings before loading the schema.
   - This repo's existing Prisma schema and SQL migrations contain foreign key relations.
   - Keeping PlanetScale foreign keys enabled is the smallest behavior-preserving setup.
   - If foreign keys are left disabled, the project would need a deliberate Prisma `relationMode = "prisma"` workflow and extra index review.
3. Create or use a staging branch, for example `staging`.
4. Create branch credentials from PlanetScale's **Connect** panel.
5. Copy the MySQL connection string. It should look like:

```env
DATABASE_URL=mysql://USERNAME:PASSWORD@HOST.connect.psdb.cloud/DATABASE?sslaccept=strict
```

The `sslaccept=strict` parameter is important. The API's Prisma MariaDB adapter already reads that parameter and enables TLS.

## Load Schema Into Staging

For a fresh PlanetScale staging branch, replay the repository's migration
history so later deploys remain safe:

```powershell
$env:DATABASE_URL="mysql://USERNAME:PASSWORD@HOST.connect.psdb.cloud/DATABASE?sslaccept=strict"
npm run prisma:migrate
```

For the existing Aiven staging database, use the guarded project command instead:

```powershell
npm run prisma:migrate:staging
```

Do not use `prisma:push` for shared staging databases. It changes schema without
recording migration history and makes future `prisma migrate deploy` runs fail.

## Render Staging API Env

Set these on the Render staging API service:

```env
NODE_ENV=production
DATABASE_URL=mysql://USERNAME:PASSWORD@HOST.connect.psdb.cloud/DATABASE?sslaccept=strict
CORS_ORIGIN=https://<vercel-staging-domain>
WEB_ORIGIN=https://<vercel-staging-domain>
APP_ORIGIN=https://<vercel-staging-domain>
JWT_SECRET=<staging-only-secret>
ENCRYPTION_KEY=<staging-only-key>
MAPBOX_ACCESS_TOKEN=<mapbox-token>
NEXT_PUBLIC_MAPBOX_TOKEN=<mapbox-public-token>
```

Keep `COOKIE_DOMAIN` blank unless staging uses a stable custom parent domain shared by web and API.

## Vercel Staging Env

Set these on the Vercel staging or preview environment:

```env
API_ORIGIN=https://<render-staging-api-domain>
NEXT_PUBLIC_API_URL=https://<render-staging-api-domain>
NEXT_PUBLIC_SOCKET_URL=https://<render-staging-api-domain>
MAPBOX_ACCESS_TOKEN=<mapbox-token>
NEXT_PUBLIC_MAPBOX_TOKEN=<mapbox-public-token>
```

## Required Staging Test

Before production:

1. Open Vercel staging web.
2. Confirm `/config/map-token` returns a token status through the app flow.
3. Log in as a driver.
4. Open `/driver/map?live=1` on a real phone.
5. Confirm Mapbox renders once and stays smooth while location updates.
6. Confirm Socket.IO connects to the Render staging API.
7. Create a test booking or driver trip using staging data only.
8. Run:

```powershell
$env:API_URL="https://<render-staging-api-domain>"
npm run smoke-test
```

