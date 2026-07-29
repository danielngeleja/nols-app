# Deployment (Vercel + AWS Elastic Beanstalk + AWS RDS)

For production-stability gates, immutable migration rules, physical schema
verification, Redis/worker topology, and the AWS release sequence, follow
[`docs/PRODUCTION_STABILITY_RUNBOOK.md`](docs/PRODUCTION_STABILITY_RUNBOOK.md).

This repo is a Node.js monorepo (workspaces) with:
- **Web**: `apps/web` (Next.js)
- **API**: `apps/api` (Express + Socket.IO)
- **DB**: Prisma schema in `prisma/schema.prisma`

## Target architecture

- **Frontend**: Vercel (best for Next.js)
- **Production backend**: AWS Elastic Beanstalk (supports Socket.IO)
- **Legacy or staging backend**: Render, when explicitly configured
- **Database**: AWS RDS (MySQL 8+)

## CI/CD flow (recommended)

### CI (GitHub Actions)
This repo already has CI in `.github/workflows/ci.yml`:
- lint + typecheck
- tests
- builds
- (optional) docker build on `main`

Recommended branch protection:
- Require CI checks to pass before merging to `main` / `develop`

### CD (Vercel + Render GitHub integrations)
Use provider GitHub integrations instead of custom deploy jobs:
- **PRs**: run CI, and rely on Vercel Preview Deployments
- **develop**: deploy to **staging** (Render staging service + Vercel preview or a dedicated staging project/domain)
- **main**: deploy to **production**

Why this is simpler:
- fewer secrets in GitHub
- fast rollbacks in each provider
- deployments automatically track commits

## Environment variables

### API (Render) required
At minimum:
- `NODE_ENV=production`
- `DATABASE_URL=...` (RDS connection string)
- `JWT_SECRET=...` (JWT signing key)
- `ENCRYPTION_KEY=...` (32-byte key for AES-256-GCM; base64 recommended)
- `WEB_ORIGIN=https://<your web domain>`
- `CORS_ORIGIN=https://<your web domain>`

Common optional:
- `COOKIE_DOMAIN=.yourdomain.com` (share cookies across subdomains)
- `REDIS_URL=...` (required if you enable Redis-backed features)
- **SMS — Africa\'s Talking (primary, East Africa)**
  - `AFRICASTALKING_USERNAME` — your AT account username
  - `AFRICASTALKING_API_KEY` — copy from [africastalking.com](https://africastalking.com) → Settings → API Key
  - `AFRICASTALKING_SENDER_ID` — (optional) registered alphanumeric sender, e.g. `NoLSAF`
- **SMS — Twilio (optional fallback)**
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

If you run a separate staging frontend/domain, add it too:
- `CORS_ORIGIN=https://prod.example.com,https://staging.example.com`

Notes:
- Socket.IO origin checks are in `apps/api/src/index.ts` and use `WEB_ORIGIN`, `APP_ORIGIN`, and `CORS_ORIGIN`.
- Express CORS is configured in `apps/api/src/security.ts` and also uses `CORS_ORIGIN`.

### Web (Vercel) required
- `API_ORIGIN=https://<your api domain>` (used by Next.js rewrites)
- `NEXT_PUBLIC_API_URL=https://<your api domain>` (some client code uses this)
- `NEXT_PUBLIC_SOCKET_URL=https://<your api domain>` (Socket.IO client connects directly to API)

Important:
- Vercel cannot reliably proxy WebSocket upgrades through Next rewrites; the socket client should connect directly to the API origin.

### Auth cookies + sockets (important)
This app issues **httpOnly auth cookies**. If your **web** and **api** are on different domains (e.g. `*.vercel.app` and `*.onrender.com`), browsers will not send those cookies to the API origin.

If you need authenticated Socket.IO connections from the browser:
- Best fix: use a **custom domain** with subdomains (e.g. `app.example.com` + `api.example.com`) and set `COOKIE_DOMAIN=.example.com` on the API.
- Alternative: authenticate sockets via a Bearer token in `auth: { token }` (requires storing a token client-side; different security tradeoffs).

## Database migrations (production)

Use migrations in production (do **not** use `prisma db push --accept-data-loss`).

From repo root `nolsaf/`:
- `npm run prisma:migrate`

Recommended operational pattern on Render:
- Run `npm run prisma:migrate` as a **pre-deploy / release step** (preferred)
- Or run it manually before switching traffic

Migration directory names are immutable once applied to a shared environment.
Never rename, reorder, or delete an applied migration. Add a new forward-only
migration instead. For the existing Aiven staging database, use
`npm run prisma:migrate:staging`; it safely reconciles the repository's known
legacy aliases before running the standard deploy command.

### AWS Elastic Beanstalk production runbook

[`API_DEPLOYMENT_GUIDE.md`](API_DEPLOYMENT_GUIDE.md) is the authoritative,
copy-ready AWS production runbook. It covers:

- staging QA and promotion to `main`;
- RDS snapshot creation and verification;
- Elastic Beanstalk bundle validation and deployment;
- production-safe Prisma migrations over EB SSH;
- post-deployment health checks;
- failed-migration recovery and snapshot-clone testing;
- application rollback and troubleshooting.

For a normal API release, never use raw `eb deploy`. The required entry point is:

```powershell
cd D:\nolsapp2.1\nolsaf\apps\api
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-eb.ps1
```

Create and verify the RDS snapshot before running the Prisma migration section
of the authoritative runbook.

## Render setup (API)

### Option A: Render Docker service (matches repo)
- Build context: `nolsaf/`
- Dockerfile: `nolsaf/Dockerfile`
- Port: `4000`
- Health check path: `/ready` (or `/health`)

### Scaling caution (background workers)
The API process starts background jobs (see `apps/api/src/index.ts`).
If you scale the API to multiple instances, those jobs can run multiple times.

Simplest safe production choice:
- Keep API at **1 instance** until workers are split into a dedicated worker service.

## Vercel setup (Web)

Create a Vercel project pointing to `apps/web`.

Because this is a monorepo, the common working configuration is:

- Root directory: `nolsaf/apps/web` (use forward slashes)
- Install command: `cd ../.. && npm ci`
- Build command: `cd ../.. && npm run prisma:generate && npm run --workspace=@nolsaf/web build`

(You can also rely on Vercel’s install step and set build command to only the build portion.)

If Vercel shows: "No Next.js version detected", it almost always means the **Root Directory** is pointing at `nolsaf/` (workspace root) instead of `nolsaf/apps/web`.

## Staging vs production

- **Production**: `main` branch
- **Staging**: `develop` branch

Recommended:
- Two Render services: `api-prod` (main) + `api-staging` (develop)
- Vercel: production on `main`; staging on a separate project/domain or use Preview deployments for `develop`

## Rollbacks

- Vercel: rollback by selecting a previous deployment
- Render: rollback by redeploying a previous commit/image
- DB: prefer forward-only migrations; if you need rollbacks, plan explicit down migrations
