## Change summary

Describe the intended outcome and affected surfaces.

## Delivery classification

- [ ] Application/UI only; exact diff has no Prisma or database compatibility change
- [ ] Prisma/schema-bearing change
- [ ] Infrastructure or deployment behavior change
- [ ] Documentation only

Target integration branch: `staging`

## General definition of done

- [ ] Diff contains only intended files
- [ ] Focused tests pass
- [ ] Lint and typecheck pass
- [ ] Relevant test suites pass
- [ ] Required builds pass
- [ ] No secrets, production data, or environment URLs are present
- [ ] Documentation reflects changed behavior or operations

## Prisma gate

Complete when Prisma or database compatibility changes; otherwise mark not
applicable in the PR description.

- [ ] `schema.prisma`, new forward migration, checksum manifest, compatible code, and tests are included together
- [ ] No shared or applied migration was edited, renamed, reordered, or deleted
- [ ] Migration SQL was reviewed for destructive behavior, retry safety, data preservation, orphans, indexes, locks, and MariaDB support
- [ ] `npm run migrations:checksums` passes
- [ ] `npm run migrations:coverage` passes
- [ ] Disposable migration/reconciliation validation passes with zero physical diff
- [ ] Application remains compatible until the migration is verified present

## Staging evidence

Record after integration; do not use production for QA.

- Staging commit SHA:
- CI result:
- Migration head:
- Staging checksum/status/physical diff:
- Authenticated and functional QA:
- Responsive UI QA, when applicable:
- Approver:

## Snapshot-clone evidence for Prisma changes

- Source snapshot and timestamp:
- Disposable clone identifier:
- Preflight result:
- Migration result:
- Checksum/status/physical diff:
- Clone deleted after validation:

## Stop conditions or follow-up

List unresolved risk, required approval, rollback consideration, or explicitly
deferred work. Follow `nolsaf/docs/ENGINEERING_DELIVERY_POLICY.md`.
