# NoLS — Networked occupancy & Logistics System

[![License: Proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](#license)
[![Stack: Next.js + Node.js](https://img.shields.io/badge/stack-Next.js%20%2B%20Node.js-blue.svg)](#tech-stack)

A production-grade, multi-tenant SaaS platform for real-time accommodation discovery, booking management, and transport coordination across East Africa. Built on a monorepo architecture with a decoupled API layer, server-side rendering, and event-driven state synchronization.

---

## Architecture Overview

The system follows a **monorepo microservices-inspired architecture** using pnpm workspaces, with clear separation of concerns across three application boundaries:

- `apps/api` — RESTful backend service (Node.js + Express + TypeScript) exposing authenticated endpoints for CRUD operations, session management, and business logic orchestration
- `apps/web` — Isomorphic Next.js 14 frontend leveraging the App Router, React Server Components (RSC), and client-side hydration for interactive UI segments
- `apps/public` — Statically optimized public-facing portal for unauthenticated users
- `packages/shared` — Cross-cutting concerns: shared TypeScript types, Zod validation schemas, constants, and utility functions
- `packages/prisma` — Encapsulated Prisma ORM client with generated type-safe query builders

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend Framework | Next.js 14 (App Router) | SSR, RSC, routing, ISR |
| Styling | Tailwind CSS | Utility-first responsive UI |
| Backend Runtime | Node.js + Express | REST API, middleware, auth |
| Language | TypeScript (strict mode) | End-to-end type safety |
| ORM | Prisma 7 | Type-safe DB access, migrations |
| Database | MariaDB / MySQL | Relational data persistence |
| Caching Layer | Redis | Session store, rate limiting |
| Maps | Mapbox GL JS | WebGL-rendered interactive maps |
| Monorepo Tooling | pnpm workspaces | Dependency hoisting, workspace linking |
| Containerization | Docker | Reproducible deployment environments |

---

## Core Domain Features

- **Multi-role RBAC** — Role-based access control across Customer, Owner, Driver, and Admin roles with JWT-based session tokens and configurable TTLs
- **Property Listings** — Full CRUD lifecycle for property entities with geospatial coordinates, image uploads, amenities, star ratings, and availability management
- **Booking Engine** — Real-time reservation system with conflict detection, status state machine (PENDING → CONFIRMED → COMPLETED / CANCELLED), and payment event tracking
- **Group Stays Module** — Multi-occupancy booking flows with origin/destination routing, driver assignment, and group size validation
- **Driver Portal** — Driver onboarding, KYC document management, suspension lifecycle, trip tracking, and earnings reconciliation
- **Geolocation Integration** — Mapbox GL WebGL map with deferred mount (lazy initialization), drag-to-pin UX, and coordinate persistence
- **Tanzania Administrative Data** — Complete hierarchical region → district → ward → street dataset covering 31 mainland regions + 5 Zanzibar regions (140 wards, TCRA-compliant postcodes)

---

## Project Structure

```
nolsaf/
├── apps/
│   ├── api/                  # Express REST API service
│   ├── web/                  # Next.js 14 owner/customer/driver portals
│   └── public/               # Next.js public-facing static portal
├── packages/
│   ├── prisma/               # Prisma client + generated types
│   └── shared/               # Shared types, constants, Zod schemas, utils
├── prisma/
│   ├── schema.prisma         # Unified data model
│   └── migrations/           # SQL migration history
└── scripts/                  # Ad-hoc DB migration and backfill scripts
```

---

## Development Setup

### Prerequisites

- Node.js ≥ 18.x
- pnpm ≥ 9.x
- MariaDB 10.6+ or MySQL 8.x
- Redis 7.x

### Install

```bash
pnpm install
```

### Environment Variables

Provision a `.env` file at the workspace root. Required variables:

```env
DATABASE_URL=mysql://user:password@localhost:3306/nolsdb
REDIS_URL=redis://localhost:6379
NEXTAUTH_SECRET=your_secret
MAPBOX_TOKEN=pk.eyJ1...
```

For multi-instance API deployments that use Socket.IO, enable Redis pub/sub and sticky sessions:

```env
SOCKET_IO_REDIS_ADAPTER=true
SOCKET_IO_REDIS_URL=redis://user:password@redis-host:6379
```

`SOCKET_IO_REDIS_URL` is optional when `REDIS_URL` points to the same Redis service.

For scaled deployments, run scheduled/background jobs from one dedicated worker process only:

```env
RUN_BACKGROUND_WORKERS=false
```

Keep that value on normal API instances. Set `RUN_BACKGROUND_WORKERS=true` only on the worker service that should run scheduled jobs such as stale booking expiry, transport auto-dispatch, and owner licence reminders.

### Run in Development

```bash
# Concurrent API + Web dev servers
pnpm dev

# Isolated per package
pnpm --filter api dev
pnpm --filter web dev
```

### Database changes

Follow the authoritative
[`docs/ENGINEERING_DELIVERY_POLICY.md`](docs/ENGINEERING_DELIVERY_POLICY.md).
Prisma schema, a new forward-only migration, its checksum, and compatible code
must be reviewed and committed together.

```powershell
npm run prisma:generate
npm run migrations:checksums
npm run migrations:coverage
```

Never run `prisma migrate dev`, `db push`, or `migrate reset` against staging or production.

---

## Author

**Daniel Mussa Ngeleja** — Tanzania, 2026

---

## License

Copyright (c) 2026 Daniel Mussa Ngeleja. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, or use is strictly prohibited. See [LICENSE](./LICENSE) for full terms.
