# NoLSAF release evidence record

Copy this template into the approved release ticket or dated release record. Do
not record secrets, database URLs, private keys, tokens, or production data.

Policy: [`ENGINEERING_DELIVERY_POLICY.md`](ENGINEERING_DELIVERY_POLICY.md)

## Release identity

- Release description:
- Operator:
- Approver:
- Feature commit SHA:
- Approved staging SHA:
- Main SHA:
- `origin/main` SHA:
- Application-only or schema-bearing:
- Planned release window:

## Change set

- Affected applications/packages:
- Prisma schema changed:
- Migration names:
- Migration head:
- Expected migration count:
- Compatibility classification:
- Feature flag or rollout control:

## Local and CI evidence

- [ ] Intended diff reviewed
- [ ] Migration immutability check passed
- [ ] Migration checksum check passed
- [ ] Schema-to-migration coverage passed
- [ ] Disposable migration validation passed
- [ ] Physical schema diff was zero
- [ ] Lint passed
- [ ] Typecheck passed
- [ ] Relevant tests passed
- [ ] Required builds passed
- CI run/link:

## Staging qualification

- Staging database fingerprint without credentials:
- Migration status:
- Checksum result:
- Physical schema diff:
- Functional/authenticated QA result:
- UI/responsive QA result:
- Redis/worker result when applicable:
- QA approver and timestamp:

## Production-snapshot clone qualification

- Authorization reference:
- Source snapshot identifier and timestamp:
- Disposable clone identifier:
- Data preflight result:
- Migration result:
- Checksum result:
- Physical schema diff:
- Functional result, if applicable:
- Clone deletion confirmation:

## Production readiness

- Fresh production-change approval:
- AWS account/region verified:
- Pre-release API health:
- EB status/version before release:
- Redis and worker ownership:
- Recovery owner:
- RDS recovery snapshot identifier/status:
- API bundle validation result:

## Migration execution

Complete only for schema-bearing releases.

- Designated runner:
- Exact source SHA:
- Prisma CLI version agreement:
- Pre-migration status:
- Applied migrations:
- Post-migration status:
- Required physical objects verified:
- Start/end timestamp:

## Application deployment

- EB application version:
- Vercel deployment/version when applicable:
- Deployment start/end timestamp:
- Final EB status/health:
- API health/readiness:
- Prisma error/5xx observation:
- Worker lease ownership:

## Closure

- Rollback candidate:
- Recovery snapshot retention decision:
- Outstanding follow-up:
- Final approver:
