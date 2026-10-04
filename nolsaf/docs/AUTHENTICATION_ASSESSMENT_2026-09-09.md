# NoLSAF authentication assessment — 9 September 2026

## Verdict

**The original provisional rating was 6/10 before the subsequent TOTP repair.** The owner TOTP finding is now resolved in the local working tree and its former expected-failure test passes normally. This document records code and local test evidence, not production certification or a newly calculated security score.

The owner-to-traveller symptom is reproducible through local code. We do not have the affected account, its browser cookies, or its original requests, so the reproductions below establish possible causes, not which cause occurred in that person's session.

## Scope and method

Reviewed and exercised registration, password login, phone/email OTP, owner onboarding, JWT verification, session binding/revocation, role gates, administrator password challenge, CSRF, socket authentication, selected NRMS access checks, and web login routing.

The new API suite executes real Express routes with Supertest, real Argon2 password hashing, real JWT signing/verification, real session-cookie generation, and the production authentication/role middleware. Database persistence is an in-memory Prisma substitute. Email and SMS delivery are captured fakes. Redis is disabled in the new suite. The probe endpoints exercise the real guards but do not substitute for testing every business endpoint.

The new web suite transpiles and executes the actual Next.js middleware with NextRequest objects. Its synthetic JWTs test navigation, not signature verification. Earlier web tests named after middleware exercised routing helpers; those passing tests did not cover the cookie-selection defect.

No production probing, real account registration, external message delivery, database modification, deployment, or browser-based end-to-end session was performed. WebAuthn device ceremonies, distributed Redis failures/races, database isolation/constraints, and production proxy/cookie-domain behavior remain outside the demonstrated coverage.

## Reproduced defects and local repairs

| Finding | Before | Local repair and evidence |
|---|---|---|
| Conflicting authentication cookies | The API preferred `nolsaf_token`, but web middleware preferred `token`. An owner primary token plus an older traveller legacy token sent `/owner` to `/login`, then `/account`. | Web middleware now follows API precedence, including host-prefixed aliases. New middleware tests reproduce both directions of the conflict and now pass. |
| Writable role-cookie fallback | A `role=ADMIN`, `OWNER`, or `DRIVER` cookie could admit a portal shell without a valid token role. This was page routing; it did not demonstrate protected API data access. | Removed the writable cookie fallback. Missing or malformed token roles cannot gain routing authority from that cookie. API guards still provide actual authorization. |
| Ambiguous login identity | A single `findFirst` searched email, phone, and display name. A traveller display name equal to an owner's email could select the traveller. With equal passwords in the fixture, owner-email login returned the traveller's ID and role; with different passwords, this can reject the owner's valid credentials. | Password login selects only the supplied canonical email or phone. Display-name login is removed. Email case and local phone forms are tested. The web password form already requests an email address. |
| Silent registration role fallback | Explicit unsupported roles, including `OWENR`, became `CUSTOMER`. Attempts to register `ADMIN` did not grant admin privileges, but silently creating the wrong account type is still incorrect. | Unsupported explicit roles return HTTP 400 in registration and OTP endpoints. Missing/empty registration role retains the existing traveller default for compatibility; supported owner/driver/traveller values retain their meaning. |
| Onboarding bypassed live-session checks | `/api/auth/profile` checked the JWT signature directly. Tests demonstrated successful profile writes from revoked, suspended, disabled, and impersonated sessions. | Added the shared `requireAuth` and `blockImpersonated` guards, removing independent token parsing. The four rejection tests pass, and legitimate owner OTP signup → onboarding → password login still succeeds as OWNER. |

Source changes: `apps/api/src/routes/auth.ts`, `apps/web/middleware.ts`, and the web test command in `apps/web/package.json`.

Regression suites: `apps/api/src/__tests__/authAdversarial.test.ts` and `apps/web/middleware.auth-boundary.test.mjs`.

## Owner TOTP finding — repaired locally

The original high-priority defect allowed an owner with TOTP enabled to obtain a usable session using only a password. That path now returns HTTP 202 with an opaque, five-minute verification challenge and no session token. The original `it.fails` marker has been removed.

Password, phone/email OTP, and passkey login all request the enrolled TOTP before issuing a full session. The shared web login screen displays an authenticator-code gate, provides a backup-code option, and handles invalid/expired/limited verification. The API response includes a challenge ID for clients that do not use browser cookies.

`POST /api/auth/mfa/verify` validates the authenticator code using real TOTP cryptography or consumes a saved backup code using a database compare-and-set update. Challenges allow five attempts, with a separate ten-attempt account budget over fifteen minutes that cannot be reset by changing IP or starting another challenge. Challenges and TOTP replay markers use atomic Redis operations in production. A concurrent verification has only one winner. Challenge state is bound to the account identity, role, credential version and authenticator enrollment; expiry, suspension, disablement and changes invalidate it.

HTTP authentication and socket handshake/ongoing-policy checks require signed MFA proof bound to the current authenticator enrollment. Existing password-only sessions for TOTP-enabled accounts require a new sign-in. A missing enrolled secret fails closed. Authorized support impersonation retains its separate restrictions; it is not treated as the owner's normal login.

New tests use actual encryption/decryption, TOTP generation/verification, backup-code hashing, JWT verification and CSRF middleware. The passkey policy test substitutes a successful WebAuthn ceremony to test the subsequent TOTP gate; it does not claim hardware ceremony coverage. Local concurrency and account-attempt tests use the in-memory store. Redis Lua operations and database JSON compare-and-set still need validation against actual staging infrastructure.

Administrator behavior is different: password login returns a challenge without a full session, and email/SMS login OTP is rejected as a substitute for administrator MFA in the tested paths.

**Rollout requirement:** production MFA verification requires a healthy configured Redis connection. Store failure returns a service error and never bypasses verification. No schema migration is needed. The enforcement applies to non-admin accounts configured for TOTP; legacy SMS-only two-factor settings were outside this specific repair. Existing backup codes provide recovery; loss of both authenticator and backup codes requires the support recovery process. Password reset does not disable TOTP.

Implementation: `apps/api/src/routes/auth.accountMfa.ts`, `apps/api/src/lib/accountMfaPolicy.ts`, the login/session/auth/socket/CSRF integrations, and `apps/web/components/security/AccountMfaLoginGate.tsx`. The new screen is typechecked; a live browser sign-in ceremony has not been run.

## Results

| Verification | Result |
|---|---|
| Existing selected API suites before changes | 127 passed across 15 files |
| New API adversarial suite after TOTP repair | 55 passed; no expected failures |
| Combined selected API run after TOTP repair | 182 passed across 16 files; no expected failures |
| Full configured web test command after repairs | 47 passed, including 5 new actual-middleware tests |
| Existing generated redirect-policy cases | 20,000 cases within one passing test, plus the 1,040-combination matrix; these are not separate penetration-test executions |
| API TypeScript check | Passed: `npm exec -- tsc --noEmit --pretty false` |
| Web TypeScript check | Passed: `npm exec -- tsc --noEmit --pretty false --incremental false` |
| Whitespace/diff check | Passed: `git diff --check` |

Demonstrated protections include rejection of tampered/unsigned/expired/foreign-key JWTs; session/user mismatches; missing and revoked sessions; stale role claims after demotion; administrator access after promotion without MFA; suspended/disabled/idle sessions; header impersonation; OTP replay/expiry/destination mismatch; owner signup-role substitution; malformed credential objects; and repeated-password lockout in the local fallback path.

The passing count cannot establish that every authentication endpoint is safe. In particular, sequential OTP replay tests do not establish concurrent single-use behavior across servers. No coverage percentage or independent penetration-test attestation is claimed.

## Reproduction commands

From `apps/api`:

```powershell
cmd /c npm exec -- vitest run src/__tests__/authAdversarial.test.ts src/__tests__/authLifecycle.test.ts src/middleware/auth.test.ts src/lib/sessionManager.test.ts src/lib/authorizationInvalidation.test.ts src/__tests__/loginAppRolePolicy.test.ts src/__tests__/passwordPolicy.test.ts src/__tests__/otpRateLimit.test.ts src/__tests__/invoiceAccessAndCsrf.test.ts src/__tests__/securityHardening.test.ts src/middleware/socketAuth.test.ts src/lib/securitySettings.test.ts src/lib/nrmsAuthorization.test.ts src/lib/nrmsPropertyAccess.test.ts src/routes/nrms.operations.access.test.ts src/routes/owner.nrms.sales.access.test.ts
cmd /c npm exec -- tsc --noEmit --pretty false
```

From `apps/web`:

```powershell
cmd /c npm test
cmd /c npm exec -- tsc --noEmit --pretty false --incremental false
```

## Follow-through

Exercise the authenticator/backup-code screen and account switching in a real staging browser, then validate real database session revocation, JSON compare-and-set recovery-code consumption, Redis challenge/attempt/replay operations, and distributed OTP/passkey behavior. Investigate any historical accounts with the wrong stored role from their registration/audit evidence; do not bulk-convert travellers to owners based on a login URL or claimed intent.

These repairs are local working-tree changes. They have not been deployed, and no existing account roles have been changed.
