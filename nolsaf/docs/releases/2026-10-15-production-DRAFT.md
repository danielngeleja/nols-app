# NoLSAF release evidence record: 2026-10-15 production (DRAFT)

Template: [`RELEASE_EVIDENCE_TEMPLATE.md`](../RELEASE_EVIDENCE_TEMPLATE.md).
Policy: [`ENGINEERING_DELIVERY_POLICY.md`](../ENGINEERING_DELIVERY_POLICY.md).
No secrets, database URLs, or production data are recorded here. All times UTC.
Rename to `2026-10-15-production-<main sha>.md` once `main` is pushed.

## Release identity

- Release description: promote staging to production (admin console redesign:
  home, sidebar and header with live counts and jump search, Action Center,
  Bookings lifecycle, Travellers, Transport, Support desk; operator and admin
  notification inbox scoping; app distribution settings; editable support address;
  public footer Explore column and official contacts)
- Operator: Daniel Mussa Ngeleja
- Approver: Daniel Mussa Ngeleja
- Approved staging SHA: `02a4eb01` plus the pending test-only commit (see Local evidence)
- Main SHA: pending
- Application-only or schema-bearing: schema-bearing

## Change set

- Affected applications/packages: `@nolsaf/api`, `@nolsaf/web`, `@nolsaf/prisma`
- Prisma schema changed: yes
- Migration names:
  - `20261011100000_add_app_distribution_settings` (new table)
  - `20261015100000_add_support_address` (nullable column on `systemsetting`)
- Migration head: `20261015100000_add_support_address`
- Expected migration count: 212 files
- Compatibility classification: additive. Backward compatible with the current
  production API. Order matters: the new API reads `systemsetting.supportAddress`
  on every full settings read, so migrate BEFORE deploying the API.
- New read-only API routes: `/api/admin/nav-counts`, `/api/admin/support/overview`,
  `/api/admin/users/travellers`; `/api/admin/users/transport-bookings` response reshaped
  (only consumer is the admin page in this release).

## Local evidence (2026-10-15, operator machine; CI billing-locked)

- [x] Migration checksum check passed (212 recorded)
- [x] API typecheck, web typecheck: pass
- [x] API lint, web lint: pass
- [x] Web tests: 57 pass, 0 fail
- [x] API tests: 2101 pass after fix. One failure was a date-dependent test
  (`public.nrmsGuest.hold-idempotency.test.ts` used check-in 2026-10-12, now in the
  past; the route correctly rejects past check-ins). Fixed by pinning the test clock
  to 2026-09-12 (Date only). Test-only change; must be committed before promotion.

## Staging evidence

- Guarded status (`npm run prisma:migrate:staging:status`): 212 local, 0 pending
  (both new migrations already applied on Aiven staging)
- `schema:check:staging`: checksums match, schema up to date, no physical difference

## Production-snapshot clone qualification

- Authorization reference: Daniel, 2026-10-15 session ("go ahead": create and delete clone)
- AWS account/region verified: `777539904046`, `eu-north-1`
- Source snapshot identifier and timestamp: `database-1-qualification-20261015110753`, 2026-10-15 11:08:08 (retained)
- Disposable clone identifier: `database-1-migration-test-20261015110753`
  (private, encrypted, MariaDB 11.8.6, db.t4g.micro, same subnet group, security
  group and parameter group `nolsaf-mariadb11-8` as production)
- Access: SSH tunnel through the production EB instance to the clone endpoint only
- Data preflight result: pass. `app_distribution_settings` absent; `systemsetting.supportAddress`
  absent; `systemsetting` has 1 row (id 1); clone head `20261010120000_support_impersonation_handoff`;
  11 historical rolled-back rows, already accounted for by the schema check
- Migration result: both applied (`prisma migrate deploy`, 212 files)
- Post-check: new table and column present; `systemsetting` still 1 row; head `20261015100000_add_support_address`
- Checksum result: match
- Physical schema diff: zero (`schema:check:clone`)
- Functional result: not run
- Clone deletion: `delete-db-instance` issued 2026-10-15 on Daniel's authorization; source snapshot retained
- Production `database-1` untouched during qualification (status `available`)

## Production readiness

- Pending: merge `staging` into `main` (`--no-ff`), push, recovery snapshot,
  `prod-migrate.sh status|deploy`, `aws-production.ps1 deploy -ConfirmProduction -DatabaseChange AppliedAndVerified`
- Known operational notes: AzamPay allowlist breaks on new instance IP; keep Min instances = 1 (no Redis);
  EB env DATABASE_URL is authoritative (`apps/api/.env.production` is stale)
