# Aiven MySQL Staging Setup

Use Aiven MySQL as the isolated staging database for the Render staging API.

## Database URL

Aiven gives a URL like:

```env
DATABASE_URL=mysql://avnadmin:<password>@<host>.aivencloud.com:<port>/defaultdb?ssl-mode=REQUIRED
```

Do not commit the real value to the repo. Put it only in Render's staging API environment variables.

## Render Staging API

Set these on the Render staging API service:

```env
NODE_ENV=production
DATABASE_URL=mysql://avnadmin:<password>@<host>.aivencloud.com:<port>/defaultdb?ssl-mode=REQUIRED
CORS_ORIGIN=https://<vercel-staging-domain>
WEB_ORIGIN=https://<vercel-staging-domain>
APP_ORIGIN=https://<vercel-staging-domain>
JWT_SECRET=<staging-only-secret>
ENCRYPTION_KEY=<staging-only-key>
MAPBOX_ACCESS_TOKEN=<mapbox-token>
NEXT_PUBLIC_MAPBOX_TOKEN=<mapbox-public-token>
```

Keep `COOKIE_DOMAIN` blank unless staging uses a stable custom parent domain shared by web and API.

## Apply Migrations

Use the guarded staging migration command from the `nolsaf/` repository root. It
loads `apps/api/.env.staging`, verifies that the target is Aiven staging, repairs
the repository's known legacy migration-name aliases when their checksums and
database structures match, and then runs `prisma migrate deploy`:

```powershell
npm run prisma:migrate:staging
```

Check status without changing the database:

```powershell
npm run prisma:migrate:staging:status
```

If a renamed baseline previously failed after partially creating duplicate
exact-case tables, remove only verified-empty artifacts with:

```powershell
npm run prisma:migrate:staging:cleanup
```

The cleanup requires the verified legacy baseline history and aborts before
dropping anything if any artifact table contains data.

Do not initialize shared staging with `prisma db push`. That creates schema
without durable migration history and causes later `migrate deploy` failures.
Do not rename or delete a migration directory after it has been applied to any
shared environment; Prisma treats the directory name as an immutable ID.

On Render, keep the pre-deploy command as `npm run prisma:migrate`. The guarded
repair is a one-time local staging operation; normal releases use standard
`migrate deploy` after the history is reconciled.

Then run the API smoke test against Render staging after deployment:

```powershell
$env:API_URL="https://<render-staging-api-domain>"
npm run smoke-test
```

## Security Note

If a real database password is pasted into chat, issue trackers, screenshots, or shared docs, rotate the Aiven password before using staging seriously.
