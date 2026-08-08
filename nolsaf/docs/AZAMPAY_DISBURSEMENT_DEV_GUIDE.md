# AzamPay Disbursement API: Developer Implementation Guide

Source: `NoLSAF AzamPay Disbursement Developer.pptx` (Desktop/DAILY READINGS/NoLSAF Financial 2026), converted to Markdown for the development flow. Prepared for NoLS AFRICA COMPANY LIMITED, technical reference dated 07 August 2026.

Stack target: Node.js + TypeScript + Express, sandbox-first.

**Important**: AzamPay must still provide the exact checksum field composition, public key, production endpoints, and enabled payout rails before production launch. This document is an internal implementation guideline, not a replacement for AzamPay's official documentation or merchant-specific integration instructions.

Reference sources:
- AzamPay Tanzania, Disbursement: https://developerdocs.azampay.co.tz/tanzania/disbursement
- AzamPay Tanzania, Token Generation: https://developerdocs.azampay.co.tz/tanzania/token-generation
- AzamPay OpenAPI schema: https://developerdocs.azampay.co.tz/tanzania/v1/schema.json

---

## Engineering ground rules

These apply to every phase below, without exception:

- **No commits.** Code, schema drafts, and docs generated for this integration are written to disk only. Nothing is staged, committed, or pushed on the assistant's own initiative, regardless of how complete a phase looks. Daniel reviews and commits.
- **No DB migrations without explicit written approval.** Schema changes are drafted in `prisma/schema.prisma` and a migration SQL file is prepared, but `prisma migrate` / `db push` (or any command that touches the staging/production database) is never run until Daniel says yes to that specific migration.
- **No real AzamPay disbursement calls until AzamPay confirms the checksum contract.** The client code is built and unit-testable, but is not exercised against the sandbox `/namelookup` or `/disburse` endpoints until the public key and field composition are in hand.
- **Professional standard**: typed, idempotent, transactional where money or state changes, audited, and consistent with the strongest existing pattern in the codebase (the Sales Partner payout ledger), not the weakest one (the Owner/Invoice flow).

---

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | This guide + existing payout flow audit | Done |
| 1 | Provider primitives: token cache, checksum helper, config-driven checksum input builder, HTTP client, error classifier | Done — `apps/api/src/services/azampay/disbursement/` |
| 2 | Schema draft: `Disbursement`, `DisbursementEvent`, `PayoutAccount` in `schema.prisma`, plus a hand-written migration SQL file | Drafted, **not applied** to any database. Applying needs Daniel's approval |
| 3 | Service layer: eligibility checks (reads the 4 existing flows), ledger writes (request/approve/submit/apply-event), reconciliation job | Done — `apps/api/src/services/payouts/`, typechecked against a `prisma generate`-only client (no DB touched). Runtime calls will fail until Phase 2 is applied and the tables actually exist |
| 4 | Routes: owner-facing payout view (`owner.payouts.ts`), admin review/approve/submit/reconcile (`admin.disbursements.ts`), callback endpoint (`payments.azampay.disbursement.ts`) | Done — wired into the app, typechecked and linted clean. Runtime calls fail until Phase 2 is applied, same as Phase 3 |
| 5 | Sandbox verification against real AzamPay checksum contract, then production readiness gate (see below) | Needs AzamPay's written answers to the Phase 5 question list |

Phase 3 and 4's code are fully typed (Prisma Client was regenerated from the schema draft, which only reads `schema.prisma` and never connects to a database) but cannot run for real until Phase 2's migration is applied to the actual database.

Money-moving admin actions (`approve`, `submit`, `check-status`) are gated behind `requireAdminFinanceGrant` (OTP re-auth), the same separation-of-duties control the Sales Partner payout flow already uses — this was the one existing flow flagged as most professional in the payout audit, so Phase 4 follows its pattern rather than the weaker Owner/Invoice one.

The disbursement callback route has a known provider-contract gap: AzamPay's docs do not publish a signature field for the callback payload. NoLSAF therefore requires an IP allowlist (`AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS`) and/or shared callback secret (`AZAMPAY_DISBURSE_CALLBACK_SECRET`) in every environment, then correlates external reference, provider reference, amount, and operator against the stored disbursement. The endpoint fails closed when neither authentication control is configured. AzamPay must still confirm its supported callback-authentication method before production; see the Phase 5 question list.

Note: generating the Phase 2 migration via `prisma migrate dev --create-only` failed because a pre-existing, unrelated migration (`20260714130000_reconcile_legacy_database_drift`) uses MySQL syntax this server rejects (`DROP FOREIGN KEY IF EXISTS`). That blocks Prisma's shadow-database diffing for *any* new migration, not just this one, until it's fixed separately. The Phase 2 migration SQL was hand-written instead, matching the existing migration style.

---

## How to use this guide

Build against the canonical API definitions, then confirm provider-specific values with AzamPay.

1. **Understand the flow**: how NoLSAF moves from payout eligibility to a final paid/failed state.
2. **Build provider primitives**: token, checksum, name lookup, disburse, status, callback.
3. **Protect NoLSAF logic**: eligibility, approval, idempotency, duplicate prevention, ledger/reconciliation.
4. **Resolve documentation gaps**: do not guess checksum inputs, bank support, USD support, or transfer type.

---

## NoLSAF disbursement architecture

Keep business decisions inside NoLSAF; use AzamPay as the execution rail.

Flow: eligible earnings -> verified payout account -> admin/policy approval -> processing -> callback/status -> AzamPay disburse.

**NoLSAF controls:**
- Is the booking/service truly payout-eligible?
- Is the beneficiary account verified and still active?
- Is the amount available and not reserved elsewhere?
- Has this payout already been submitted or paid?
- Who approved it, when, and under which policy?

**AzamPay controls:**
- Accept authenticated disbursement requests.
- Validate provider request/checksum rules.
- Return a `pgReferenceId` for tracking.
- Execute against the enabled FSP/MNO rail.
- Send completion status through callback/status API.

**Rule**: HTTP 200 + "Your transaction is in process" means SUBMITTED/PROCESSING. Never mark the payout PAID until a confirmed final status is received.

---

## Canonical sandbox endpoints

| Purpose | Method | Canonical sandbox endpoint |
|---|---|---|
| Token | POST | `https://authenticator-sandbox.azampay.co.tz/AppRegistration/GenerateToken` |
| Name lookup | POST | `https://api-disbursement-sandbox.azampay.co.tz/api/v1/azampay/namelookup` |
| Disburse | POST | `https://api-disbursement-sandbox.azampay.co.tz/api/v1/azampay/disburse` |
| Transaction status | GET | `https://api-disbursement-sandbox.azampay.co.tz/api/v1/azampay/transactionstatus` |
| Disbursement callback | POST | `https://api.nolsaf.com/api/payments/azampay/disbursement/callback` (NoLSAF endpoint) |

Production base URLs are not published on the disbursement doc page. Obtain them from AzamPay together with production credentials and callback registration.

Some OpenAPI code samples still show `/azampay/createtransfer` or `/azampay/gettransactionstatus`. Treat those as stale unless AzamPay explicitly confirms otherwise.

---

## Authentication: generate the access token

Every disbursement endpoint is protected by Bearer authentication.

**Request**
```
POST https://authenticator-sandbox.azampay.co.tz/AppRegistration/GenerateToken
Content-Type: application/json

{
  "appName": "NoLSAF",
  "clientId": process.env.AZAMPAY_CLIENT_ID,
  "clientSecret": process.env.AZAMPAY_CLIENT_SECRET
}
```

**NoLSAF TypeScript pattern**
```ts
export async function getAzamPayToken() {
  const res = await fetch(
    `${AUTH_HOST}/AppRegistration/GenerateToken`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: 'NoLSAF',
        clientId: env.AZAMPAY_CLIENT_ID,
        clientSecret: env.AZAMPAY_CLIENT_SECRET
      })
    }
  );
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message);
  return json.data.accessToken;
}
```

Store `clientId`/`clientSecret` only on the backend. Cache the token until shortly before expiry; never expose it to the browser or partner dashboard.

---

## Reference IDs and lifecycle

Design the state machine before writing the provider call.

States (implemented, `services/payouts/ledger.ts` + `services/payouts/batching.ts`):

`REQUESTED -> APPROVED -> BATCHED -> AUTHORIZED -> PROCESSING -> PAID / FAILED`, with a `SECURITY_REVIEW` off-ramp at batch formation and at batch authorization.

- **REQUESTED / APPROVED** — unchanged from before batching existed: admin creates the disbursement against an already-approved source (eligibility.ts) and a verified `PayoutAccount`, then approves it (`ledger.approveDisbursement`). Approval also freezes an **approval fingerprint** — see "Batch security architecture" below.
- **BATCHED / AUTHORIZED / PROCESSING** — new. See "Batch security architecture."
- There is **no manual per-item "send to AzamPay" step** in normal use. Approval only ever lands a payout in the batch queue; batch authorization is the one action that actually submits money. `ledger.submitToAzamPay` still accepts a disbursement in `APPROVED` state directly, for a manual/legacy retry of a single stuck item outside the batch flow — that path stays behind the same finance re-auth gate as everything else.

**Reference strategy:**
- NoLSAF reference: `NoLSAF-O-2608081645-D51QVX` (source-type letter: O/T/D/S, then minute-precision timestamp, then 6 random alphanumeric chars)
- Batch reference: `BATCH-2608081645-D51QV` (minute-precision timestamp, then 5 random alphanumeric chars)
- AzamPay `pgReferenceId`: e.g. `b42aeas4...cb452`
- FSP reference: received later in callback

**Rules:**
- `externalReferenceId` is required and max 30 characters.
- Make it unique in NoLSAF before calling AzamPay.
- Store `pgReferenceId` immediately after provider acceptance.
- Never identify a payout by amount alone.
- Callback processing must be idempotent.

---

## Batch security architecture

What happens after an admin approves a payout, and why it is not a single click to AzamPay. Implemented in `services/payouts/fingerprint.ts`, `services/payouts/riskScoring.ts`, and `services/payouts/batching.ts`; exposed via `routes/admin.disbursements.ts`; surfaced in the web app at `/admin/disbursements/batches` and `/admin/disbursements/security-review` (see "Disbursement Workspace" below).

**0. One live payout per source (database-enforced).**
`Disbursement.activeSourceKey` holds `"<sourceType>:<sourceId>"` while a payout is live and `NULL` once it reaches `FAILED`, under a unique index. The application-level "does this source already have a disbursement" lookup is a friendly pre-check only; two concurrent requests for the same invoice can both pass it, and the unique constraint is what actually stops the second one from existing. `FAILED` releases the key so a fresh attempt is still allowed.

**1. Approval fingerprint (frozen at approve time).**
`SHA256(id | externalReferenceId | amount | currency | provider | accountNumber | accountName | sourceType | sourceId)`, stored on `Disbursement.approvalFingerprint`. Recomputed and compared **twice**: before the payout may enter a batch, and again inside `submitToAzamPay` immediately before the money-out call. The second check matters because the first is minutes-to-hours old by the time a batch is released, and `submitToAzamPay` builds the AzamPay `destination` from the live `PayoutAccount`. A mismatch at either point diverts the payout to `SECURITY_REVIEW` instead of proceeding. A **missing** fingerprint fails closed and is treated the same way: "not locked" must never be read as "nothing changed".

**2. Batch formation (`formBatch`, automatic — a normal admin action, not money-moving).**
Pulls every `APPROVED`, unbatched disbursement and, for each:
   - **Bulk re-verifies** the payout account with AzamPay Name Lookup (closes the staleness window between approve-time verification and batch-time release — a payout account could be swapped between the two).
   - Re-checks the approval fingerprint.
   - **Risk-scores** it (`riskScoring.ts`): `RECENT_ACCOUNT_CHANGE`, `PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE`, `FIRST_PAYOUT_TO_BENEFICIARY`, `AMOUNT_ABOVE_NORMAL_RANGE`, `ACCOUNT_SHARED_ACROSS_PARTNERS`, `AFTER_HOURS_APPROVAL`, `REPEATED_RECENT_FAILURES` roll up by weight to `LOW`/`MEDIUM`/`HIGH`/`CRITICAL`.

     The scorer's job is to separate **account takeover** from **onboarding**. `RECENT_ACCOUNT_CHANGE` + `PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE` is the compromised-account pattern (an established payee whose money is suddenly redirected) and scores `CRITICAL`. A recent account change plus a first-ever payout to that beneficiary, without prior history, describes every legitimate new partner as precisely as it describes an attacker, so it scores `MEDIUM`: visible to the authorizer, not blocking. This is deliberate — a queue that fires on every onboarding gets cleared reflexively, and a control that gets cleared reflexively is not a control.

     `RECENT_ACCOUNT_CHANGE` is anchored on `PayoutAccount.destinationChangedAt`, which moves only when the provider/number/name changes. It must never be anchored on `verifiedAt`: routine batch re-verification writes `lastVerifiedAt`, and when it used to write `verifiedAt` the anchor silently degraded from "when did this destination change" into "when did a batch last run". Business hours are evaluated in `PAYOUT_RISK_TIMEZONE` (default `Africa/Dar_es_Salaam`), not the host's local time.
   - Anything that fails re-verification, fails its fingerprint check, or scores `HIGH`/`CRITICAL` is **excluded** from the batch and set to `SECURITY_REVIEW` with a reason. Everything else is grouped into a new `DisbursementBatch` (`status: DRAFT`) with a **batch fingerprint** — `SHA256` over the sorted, exact set of `externalReferenceId|amount|currency|provider|accountNumber|accountName`, read from the **live** `PayoutAccount` — and the member disbursements move to `BATCHED`.

     The fingerprint must hash the real destination, never `payoutAccountId`. Hashing the foreign key leaves a swapped account number invisible to the authorize-time check while `submitToAzamPay` happily reads the new number, which is the exact attack the check exists to catch.

     **One batch per currency**, never mixed: a mixed batch's `totalAmount` is a sum across currencies presented to the authorizer as one figure, and that figure is what a human is being asked to sign off on. Two caps bound what a single authorization can release — `AZAMPAY_DISBURSE_MAX_BATCH_TOTAL` (value ceiling, unset disables it, production should always set it) and `AZAMPAY_DISBURSE_MAX_BATCH_ITEMS` (default 250). Items that do not fit stay `APPROVED` and are picked up by the next formation.

     Concurrent formation is resolved by the database, not by a lock: the claiming `updateMany` re-asserts `status: APPROVED, batchId: null` and the whole transaction rolls back unless it claims exactly the rows it fingerprinted, so the loser of a race creates no batch at all. A MySQL `GET_LOCK` was considered and rejected — it is connection-scoped, and Prisma's pool gives no guarantee that the release runs on the connection that acquired it.

**3. Batch authorization (`authorizeBatch`, the deliberate human step — finance re-auth/OTP gated).**
Recomputes the batch fingerprint from the batch's current member state, against the live payout accounts, and compares it to the one stored at formation. A mismatch means the batch's membership or a member's destination drifted since formation — the whole batch and every member disbursement freeze to `SECURITY_REVIEW` rather than authorizing something that silently changed. On a match, the batch becomes `AUTHORIZED` and its members move to `AUTHORIZED`.

**Release authority (decided 2026-08-08).** The threat this architecture is written against is a single compromised admin session, so the ideal control is two-person release. NoLSAF operates with one finance admin today, and hard-requiring two would make release impossible rather than safe. The policy is therefore tiered:

| Path | Who | What is required |
|---|---|---|
| Two-person (strongest) | An admin who neither formed the batch nor approved any member | Finance grant only |
| Self-release | The admin who formed the batch or approved a member | Finance grant **plus** a batch-bound, single-use release code |
| Two-person enforced | Any | `DISBURSEMENT_REQUIRE_TWO_PERSON=true` retires self-release entirely |

The release code (`services/payouts/releaseChallenge.ts`) is deliberately **not** the ambient finance grant. That grant is a session-wide 15-minute "this admin re-authenticated recently" flag: it covers every money action taken in that window and proves nothing about any one of them. The release code is different in three ways that matter:

1. **Bound to the batch.** The `AdminOtp.purpose` encodes the batch id and a prefix of its fingerprint (`BR:<batchId>:<fp12>`). Change the batch and every outstanding code for it becomes unusable, so a code cannot be harvested against a small batch and spent on a larger one.
2. **Single use, 10 minutes.** Marked used inside the transaction that reads it, so two concurrent authorize calls cannot both spend it. It is spent *before* authorization proceeds, so it is burned even if the authorization then fails on a fingerprint mismatch. Five wrong codes locks that batch's challenge for 15 minutes.
3. **Out of band and descriptive.** The email/SMS states the batch reference, item count and total. A code that only says "here is your verification code" authenticates the session; one that says "this releases TSh 4,200,000 across 18 payouts" lets the admin catch a release they did not initiate, which is the entire point. An attacker holding a hijacked admin session but not the admin's mailbox cannot complete a release; if they hold both, the message is still an independent record that a release happened and for how much.

`AuditLog` records `releaseAuthority` as `TWO_PERSON` or `SELF_RELEASE_WITH_CHALLENGE` on every authorization, plus separate rows for challenges sent and challenge failures, so the weaker path is always distinguishable after the fact.

Clearing a `SECURITY_REVIEW` hold is a separate rule and has no self-service escape hatch: the payout's own approver may not clear it, because that is the one action that re-admits a payout the checks already caught.

**4. Processing (`processBatch`, driven by `workers/processAuthorizedBatches.ts`).**
Submits each `AUTHORIZED` member to AzamPay **one at a time** by default (chunks of `AZAMPAY_DISBURSE_CONCURRENCY`, which defaults to 1), via the existing `submitToAzamPay` — batching is internal bookkeeping only. `/disburse`, as documented at `https://developerdocs.azampay.co.tz/tanzania/disbursement#disburse` (checked 2026-08-08), is single-transaction: one `source`, one `destination`, one `transferDetails`, one `externalReferenceId` per call, no array-of-transfers, no batch endpoint on that page.

Note a real discrepancy, not yet resolved: AzamPay's own marketing page (`azampay.com/products/disbursement`) advertises "bulk payments" via CSV upload for both bank and mobile money disbursement — likely a feature of AzamPay's merchant dashboard (a human uploading a spreadsheet in their portal), not a programmatic API NoLSAF's backend could call, since the developer docs show no such endpoint. This is unconfirmed either way and must be asked directly (see "Questions NoLSAF must send AzamPay before production") rather than assumed from either page. Until answered, one item's failure never blocks the rest; each is caught and reported individually. From here the existing callback/status-poll reconciliation (`applyProviderEvent`) takes each item to `PAID`/`FAILED` exactly as before batching existed.

**Deliberately sequential by default, not concurrent (decided 2026-08-08).** Nothing technical stops `processBatch` from firing every authorized item at once (`Promise.all`) or in bounded chunks — each request is already independent (own checksum, own `externalReferenceId`). This was decided against as the default because AzamPay's concurrency/rate limit is one of the unanswered "Questions NoLSAF must send AzamPay before production," and firing an unknown-limit API with a burst risks a messy partial-batch failure that's harder to reconcile than a clean sequential one.

`processBatch` already supports bounded concurrency, dormant behind the `AZAMPAY_DISBURSE_CONCURRENCY` env var (`resolveDisburseConcurrency` in `batching.ts`). Unset/invalid/`<1` defaults to `1` — today's exact sequential behavior, byte-for-byte. Once AzamPay confirms a real rate/concurrency limit in writing, raise this env var to that number (clamped to a ceiling of 50 regardless of what it's set to, as a misconfiguration guard) — no code change needed, only the env var.

**Submission never runs inside an HTTP request.** Authorization is the human decision; the worker performs the submission and picks the batch up within a minute. It used to run inline in the authorize handler, which meant a gateway timeout partway through a batch left it `PROCESSING` with the remainder `AUTHORIZED` and no route back in — `authorizeBatch` refused (not `DRAFT`), `processBatch` refused (not `AUTHORIZED`), and the reconciliation worker only looks at payouts that already have a `pgReferenceId`. That is stranded money owed to partners, recoverable only by hand-editing the database.

The worker accepts a batch in `AUTHORIZED` (first pass) or `PROCESSING` (resuming), retries items whose submission never reached AzamPay, and closes the batch to `COMPLETED` once every member has settled. Retry is safe because `externalReferenceId` is allocated before the first call and never changes, so a duplicate arrives at AzamPay as a duplicate rather than as a second payment. A submission that fails is persisted as a `DisbursementEvent` — it used to exist only in the HTTP response body, so an item that never reached AzamPay left no trace anywhere.

`POST /:id/submit` is a **retry only**: the item must be `AUTHORIZED` and have no `pgReferenceId`. It previously accepted `APPROVED`, which made this entire architecture optional — one admin could approve and immediately submit, skipping bulk re-verification, risk scoring, the batch fingerprint and the second authorizer. `submitToAzamPay` now accepts `AUTHORIZED` and nothing else, so there is no path to AzamPay that does not pass through a batch someone else released.

**5. Security Review.**
A queue of everything excluded above, with its reason and risk flags. Clearing an item returns it to `APPROVED`, unbatched, so the next `formBatch` call can pick it up again — a manual confirmation that the flagged condition no longer applies, not an override of the checks themselves. Clearing requires finance re-auth, a written note of at least 10 characters (recorded on the audit log and as a `DisbursementEvent`), and an admin **other than** the one who approved that payout. Without that last rule, risk scoring was advisory only: the same compromised session that pushed a payout through approval could clear its own `CRITICAL` flag and send it on.

**Disbursement Workspace (web).** `/admin/disbursements` is a self-contained full-page workspace — own sidebar (Queue / Batches / Security Review), own "Exit to Admin" link — same pattern as the owner-side NRMS Workspace at `/owner/nrms`. The standard admin chrome is hidden for this route tree (see the pathname bypass in `(admin)/admin/layout.tsx`).

---

## Name Lookup: verify the beneficiary before payout

Use AzamPay to resolve the account holder name, then lock the verified payout destination.

```
POST /api/v1/azampay/namelookup
Authorization: Bearer <token>
Content-Type: application/json

{
  "bankName": "airtel",
  "accountNumber": "255688123821",
  "checksum": "<base64-checksum>"
}
```

**Expected success fields**

| Field | Meaning |
|---|---|
| `name` | Resolved account holder / business name |
| `fname` / `lname` | First and last name when supplied |
| `status` | Boolean success indicator |
| `statusCode` | Provider status code |
| `accountNumber` | Returned account/wallet number |
| `bankName` | Bank or Mobile Money institution name |

**NoLSAF UI rule**: beneficiary `accountName` becomes read-only after verification. Any account number/provider change must invalidate verification and require a fresh Name Lookup.

The documentation says Name Lookup can be used for bank accounts or Mobile Money. However, the disbursement request schema itself is currently MNO-focused. Confirm bank payout enablement separately.

---

## Checksum: the security primitive

AzamPay documents the algorithm, but the exact input-string composition must come from their team.

**Published rule**
```
Base64( RSA( SHA512(string) ) )
```
- RSA encryption uses PKCS1 padding.
- AzamPay supplies the required public key.
- Checksum is included in Name Lookup and Disburse requests.

**Do not guess:**
- Which fields are concatenated?
- Exact order and casing?
- Separators or no separators?
- Handling of null/optional fields?
- Epoch unit and formatting?
- Whether JSON canonicalisation is involved?

AzamPay explicitly says: "Please contact us for the fields that will be used to calculate checksum." Build the crypto helper now, but keep the input builder configuration-driven until AzamPay confirms the contract.

### Node.js / TypeScript implementation

Follow the written PKCS#1 requirement; do not use OAEP unless AzamPay confirms it.

```ts
import { createHash, publicEncrypt, constants } from 'node:crypto';

export function azamPayChecksum(
  inputString: string,
  publicKeyPem: string
): string {
  const digest = createHash('sha512')
    .update(inputString, 'utf8')
    .digest();

  const encrypted = publicEncrypt({
    key: publicKeyPem,
    padding: constants.RSA_PKCS1_PADDING,
  }, digest);

  return encrypted.toString('base64');
}
```

**Implementation notes:**
- Load the public key from a secure server-side secret/file.
- Hash raw UTF-8 bytes; encrypt the binary SHA-512 digest.
- Return Base64 text exactly once.
- Unit-test with a known AzamPay test vector when they provide one.
- Never log the full checksum input if it contains sensitive account data.

**Documentation inconsistency**: the written rule says PKCS1 padding, while published Python and Go samples use OAEP APIs. The Node.js example uses `RSA_PKCS1_PADDING` and matches the written rule. Confirm with AzamPay before certification.

---

## Disburse request schema

Canonical body shape exposed by the OpenAPI schema.

| Object / field | Required? | NoLSAF meaning |
|---|---|---|
| `source` | Yes | Configured payout source account / wallet |
| `source.countryCode` / `fullName` / `bankName` / `accountNumber` / `currency` | Yes | All required inside `source` |
| `destination` | Yes | Verified partner payout destination |
| `destination.countryCode` / `fullName` / `bankName` / `accountNumber` / `currency` | Yes | All required inside `destination` |
| `transferDetails` | Yes | type + amount + `dateInEpoch` |
| `externalReferenceId` | Yes | NoLSAF-generated unique reference, max 30 chars |
| `additionalProperties` | Optional | Metadata for traceability, avoid secrets |
| `checksum` | Schema field | Encrypted SHA-512 checksum |
| `remarks` | Optional | Human-readable payout purpose |

The OpenAPI schema currently enumerates `tigo`, `airtel`, and `azampesa` for source/destination `bankName`, despite the field description saying "bank." Treat this endpoint as MNO-focused until AzamPay confirms supported bank disbursement values.

### Example NoLSAF disbursement payload

Illustrative MNO payout; values must match NoLSAF's enabled AzamPay account configuration.

```json
{
  "source": {
    "countryCode": "TZ",
    "fullName": "NoLS AFRICA COMPANY LIMITED",
    "bankName": "azampesa",
    "accountNumber": "<NOLSAF_SOURCE_ACCOUNT>",
    "currency": "TZS"
  },
  "destination": {
    "countryCode": "TZ",
    "fullName": "SERENGETI ADVENTURES LTD",
    "bankName": "airtel",
    "accountNumber": "255688123821",
    "currency": "TZS"
  },
  "transferDetails": {
    "type": "<AZAMPAY_CONFIRMED_TYPE>",
    "amount": 850000,
    "dateInEpoch": 1786122000
  },
  "externalReferenceId": "NoLSAF-O-2608081645-D51QVX",
  "additionalProperties": {
    "bookingId": "NLS-BKG-92811",
    "payoutId": "pyt_cuid_here"
  },
  "checksum": "<BASE64_RSA_SHA512>",
  "remarks": "Partner payout"
}
```

**Important:**
- Do not copy SWIFT/SEPA from the generic documentation example for an MNO payout.
- Generate `dateInEpoch` at request time.
- Use a DB-backed unique reference before submission.
- Do not put API secrets inside `additionalProperties`.
- USD should remain feature-gated until AzamPay confirms currency/rail support.
- Source account values should come from secure configuration, not the UI.

Illustrative only. The exact checksum input fields and `transferDetails.type` are provider-confirmation items.

---

## Disbursement service: TypeScript pattern

Keep provider code in a dedicated service; routes should call NoLSAF business logic first.

```ts
export async function submitDisbursement(payout: Payout) {
  assertPayoutApproved(payout);
  assertVerifiedDestination(payout.payoutAccount);

  const token = await getAzamPayToken();
  const payload = buildAzamPayDisbursePayload(payout);
  payload.checksum = azamPayChecksum(
    buildChecksumInput(payload), // exact rule from AzamPay
    env.AZAMPAY_DISBURSE_PUBLIC_KEY
  );

  const res = await fetch(
    `${DISBURSE_HOST}/api/v1/azampay/disburse`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const body = await res.json();
  await recordProviderResponse(payout.id, res.status, body);

  if (!res.ok || !body.success) throw mapAzamPayError(res.status, body);
  await markSubmitted(payout.id, body.pgReferenceId, body.message);
  return body;
}
```

**Route layering**: admin/owner route (validates intent) -> payout service (eligibility + ledger + locking) -> AzamPay client (token + checksum + HTTP). Never let the browser call AzamPay directly.

---

## Response handling: accepted is not paid

Map provider responses into NoLSAF states deliberately.

```json
{
  "pgReferenceId": "b42aeas4hl3d4f58bhfk4007782cb452",
  "message": "Your transaction is in process",
  "success": true,
  "statusCode": 200
}
```

`POST /disburse` -> 200 / `success=true` -> `PROCESSING`.

**Persist immediately:**
- `pgReferenceId`
- provider message + HTTP/status code
- `submittedAt` timestamp
- exact request/response audit payload (redacted)
- status = PROCESSING or SUBMITTED

Only callback or a verified status response should transition PROCESSING to PAID/FAILED. A successful API submission merely means AzamPay accepted the request for processing.

---

## Callback / webhook: finalise the payout automatically

AzamPay posts the completion status to the URL registered for NoLSAF.

```json
{
  "initiatorReferenceId": "NoLSAF-O-2608081645-D51QVX",
  "fspReferenceId": "FSP-123456",
  "pgReferenceId": "AZPG-987654",
  "amount": "850000",
  "status": "success",
  "message": "Transaction completed",
  "operator": "Airtel",
  "additionalProperties": {}
}
```

```ts
router.post('/azampay/disbursement/callback', async (req, res) => {
  const cb = req.body;
  const payout = await db.disbursement.findUnique({
    where: { externalReferenceId: cb.initiatorReferenceId }
  });
  if (!payout) return res.status(200).end(); // log + review

  await assertCallbackMatches(payout, cb); // ref + amount + provider
  await insertEventIdempotently(payout.id, cb);

  if (cb.status === 'success') await markPaid(payout.id, cb);
  else if (cb.status === 'failure') await markFailed(payout.id, cb);

  return res.status(200).end();
});
```

Callback route should be publicly reachable over HTTPS, fast, idempotent, and configured with AzamPay. Return 200 after safely recording a valid/known event; move heavy downstream work to internal processing if needed.

The disbursement callback schema shown in the current docs does not publish a signature field. Do not invent one. Ask AzamPay what callback-authentication control they require (signature, secret, IP allowlist, mTLS, etc.).

---

## Transaction Status: fallback and reconciliation

Use the status API when a callback is delayed, missed, or needs manual verification.

```
GET /api/v1/azampay/transactionstatus?pgReferenceId=AZPG-987654&bankName=Airtel
Authorization: Bearer <token>
```

**When NoLSAF should query:**
- Admin presses "Check status."
- Callback has not arrived after a defined threshold.
- Reconciliation job finds a stale PROCESSING payout.
- Support investigates a beneficiary complaint.

**Reconciliation logic**

| NoLSAF state | Provider condition | Action |
|---|---|---|
| PROCESSING | Provider confirms success | Mark PAID + `paidAt` + provider refs |
| PROCESSING | Provider confirms failure | Mark FAILED, do not auto-retry blindly |
| PROCESSING | Still pending | Keep processing, schedule next check |
| PAID | Conflicting failure arrives | Freeze + manual review, never reverse ledger automatically |
| FAILED | Late success arrives | Freeze + reconcile before accounting change |

---

## Error handling and safe retry policy

Provider errors must not become duplicate payouts.

| Provider example | Meaning | NoLSAF action |
|---|---|---|
| 401, "Please Provide Valid Authorization" | Token invalid/expired | Refresh token once, retry same payout reference safely |
| 400, "Invalid BankName." | Unsupported/malformed destination/source | Fail validation, do not retry until data is corrected |
| 402, "Request expired" | Time/request freshness problem | Rebuild epoch/checksum, preserve idempotency strategy |
| 403, "Duplicate External Reference Id" | Reference already used | STOP. Query/reconcile existing payout, never generate a new ref automatically |
| Status "Transaction not found" | Provider cannot find transaction | Review pgReferenceId/operator + provider logs before any resubmission |

**Golden rule**: if there is any chance AzamPay accepted the original payout, do not create a second `externalReferenceId` and "try again." First determine the status of the original transaction.

**Retry classification**: AUTH/TEMPORARY -> limited safe retry. VALIDATION -> fix data. DUPLICATE/UNKNOWN OUTCOME -> reconcile first.

---

## Database design for disbursement

Separate incoming payment events from outgoing payout execution.

**PayoutAccount**: `userId`/`ownerId`, `type: MOBILE_MONEY | BANK`, `provider`, `accountNumber`, `accountName`, `currency`, `isVerified`/`verifiedAt`, `isDefault`/`isActive`.

**Disbursement**: `externalReferenceId` (unique), `pgReferenceId` (unique nullable), `fspReferenceId`, `payoutAccountId`, `bookingId`/`invoiceId`, `amount`/`currency`, `status`, `approvedAt`/`submittedAt`/`paidAt`, `providerMessage`/`rawResponse`.

**DisbursementEvent**: `disbursementId`, `eventType`, `status`/`message`, `pgReferenceId`/`fspReferenceId`, `amount`/`operator`, `payload`, `createdAt` (callback/status audit trail).

Keep `PaymentEvent` for money IN (collections). Use `Disbursement` for money OUT. Add `payoutEligibleAt` to `Booking` rather than stuffing provider fields into `Booking`/`Invoice`.

---

## Callback idempotency and accounting integrity

A duplicate callback must never create a duplicate financial effect.

Steps: find payout (`initiatorReferenceId` + `pgReferenceId`) -> validate (amount, provider, current state) -> deduplicate event (unique event hash / provider refs) -> atomic transaction (state + ledger + event together) -> return 200 (only after durable record).

```ts
await db.$transaction(async (tx) => {
  const locked = await lockDisbursement(tx, payout.id);
  if (await eventAlreadyApplied(tx, cb)) return;

  await tx.disbursementEvent.create({ data: mapCallback(cb) });

  if (cb.status === 'success' && locked.status !== 'PAID') {
    await tx.disbursement.update({
      where: { id: payout.id },
      data: { status: 'PAID', paidAt: new Date(), fspReferenceId: cb.fspReferenceId }
    });
    await postPartnerPayoutLedger(tx, payout);
  }
});
```

**Never do this:**
- Subtract balance twice.
- Create another payout because callback is late.
- Trust status alone without matching references/amount.
- Change PAID back to FAILED automatically on a conflicting event.
- Delete provider events after "success."

---

## Security boundary

Everything sensitive lives in the NoLSAF backend, never in the browser.

**Frontend**: payout amount/request intent, masked verified destination, status + receipts. No AzamPay secrets, no checksum generation, no public-key business logic.

**NoLSAF backend**: credentials + token cache, checksum input builder, RSA public key handling, eligibility + approval logic, provider requests + callback, ledger + reconciliation + audit.

**AzamPay**: authenticates NoLSAF, validates request/checksum, executes enabled rail, returns `pgReferenceId`, sends completion callback, provides status endpoint.

Redact account numbers and request payloads in logs. Store only what is required for support/audit, and control who can view unmasked payout details.

**Account numbers are masked in every list view** — the disbursement queue, batch detail, and the security review queue all return `••••••••1234`. The queue is a whole-population view of every partner's destination and its free-text search matches on that column, so returning full numbers made it an enumeration oracle for any `ADMIN`. The unmasked number remains on the single-item detail endpoint (`GET /admin/disbursements/:id`), where access is one record at a time and attributable in the audit log.

**Every money-touching admin action writes an `AuditLog` row**: request, approve, batch formation, batch authorization, fingerprint mismatch, security-review flag, security-review clear (with the mandatory note and the held reason), submit-retry, and manual status check. The clear action in particular is the one that re-admits a flagged payout into the pipeline, and it previously left no record of who did it or why.

**Amount mismatches are persisted, not logged.** When AzamPay reports a figure that does not match the payout, both the callback route and the status poller write an `AMOUNT_MISMATCH` `DisbursementEvent` and set `securityReviewReason`, and neither applies the reported status. The status is deliberately left as `PROCESSING` so reconciliation keeps chasing the real outcome. Previously the callback path logged to stdout and dropped it, while the status-poll path had no amount check at all — so a mismatch the callback refused was accepted by the poller 30 minutes later.

---

## Documentation inconsistencies: engineering decisions

Treat the canonical schema as the starting point, and obtain written clarification for the gaps.

| Area | What the docs currently show | NoLSAF decision |
|---|---|---|
| Disburse path | Canonical `/api/v1/azampay/disburse`, older samples use `/azampay/createtransfer` | Use canonical path |
| Status path | Canonical `/api/v1/azampay/transactionstatus`, samples show `/azampay/gettransactionstatus` | Use canonical path |
| Checksum padding | Written rule: PKCS1, Python/Go samples use OAEP APIs | Use PKCS1 in Node, request test vector |
| Disburse providers | Request schema enum: tigo, airtel, azampesa | Enable only confirmed providers |
| Bank support | Name Lookup says bank/MNO, BankProvider enum lists CRDB/NMB, disburse schema does not | Feature-gate bank payout until confirmed |
| Currency | String field, no explicit disbursement currency enum | Feature-gate USD until confirmed |
| Transfer type | Generic examples mention SWIFT/SEPA | Do not guess, ask valid local values |
| Callback security | No signature field published in DisburseCallback | Ask for signature/allowlist/auth mechanism |

This table should remain in the code repository/wiki until every "confirm" item is resolved. It prevents later developers from treating documentation placeholders as production facts.

---

## Questions NoLSAF must send AzamPay before production

**Checksum + request contract:**
- What exact fields, order, casing, and separators form the checksum input for Name Lookup?
- What exact fields, order, casing, and separators form the checksum input for Disburse?
- Please provide the RSA public key and one known checksum test vector.
- Confirm PKCS#1 v1.5 padding (not OAEP).
- Confirm `dateInEpoch` unit: seconds or milliseconds.

**Rail + production contract:**
- **Native Bulk Disbursement API availability — contested, ask directly.** The public developer docs (`developerdocs.azampay.co.tz/tanzania/disbursement#disburse`) show only a single-transaction `/disburse` endpoint, no batch/bulk endpoint. But AzamPay's own marketing page (`azampay.com/products/disbursement`) advertises bulk payments via CSV upload for bank and mobile money. Ask explicitly: is bulk/CSV a merchant-dashboard-only feature (a human uploads a file in AzamPay's portal), or is there a programmatic bulk API NoLSAF's backend can call? If the latter exists, get its endpoint, request schema, and checksum model — it is not in the public dev docs. Until answered, NoLSAF's `DisbursementBatch` stays a NoLSAF-side grouping construct only; `processBatch` submits members one at a time via the documented single-item `/disburse`.
- Which `bankName`/provider values are enabled for NoLSAF disbursement?
- Can the same API pay CRDB/NMB bank accounts? If yes, what exact values?
- Which currencies are supported for disbursement, including USD accounts?
- What values are valid for `transferDetails.type`?
- What is the callback authentication method and retry policy?
- Provide production base URL, source-account setup, limits, fees, and prefunding/settlement requirements.
- **Is there a merchant dashboard/portal for disbursement at all?** Neither the developer docs nor the marketing page name one. The developer docs' only onboarding step is "contact us to configure the callback URL" (manual, not self-service). Don't plan around AzamPay-side visibility — NoLSAF's own Disbursement Workspace (`/admin/disbursements`) is built entirely from our own DB fed by the API/callback, independent of whatever AzamPay does or doesn't expose on their side.

Do not go live until these are answered in writing or validated in sandbox with AzamPay technical support.

---

## Recommended NoLSAF code structure

Keep AzamPay-specific code replaceable and isolate business rules from provider transport.

```
apps/api/src/
  routes/
    owner.payouts.ts
    admin.disbursements.ts
    payments.azampay.disbursement.ts
  services/
    payouts/
      eligibility.ts
      provisioning.ts
      ledger.ts
      fingerprint.ts
      riskScoring.ts
      batching.ts
      reconciliation.ts
    azampay/
      disbursement/
        auth.ts
        checksum.ts
        checksumInput.ts
        client.ts
        errors.ts
  workers/
    processAuthorizedBatches.ts
    reconcileProcessingDisbursements.ts

prisma/schema.prisma
```

**Responsibilities**

| Component | Responsibility |
|---|---|
| `owner.payouts` | request + view partner payout |
| `admin.disbursements` | review / approve / form / authorize / status |
| disbursement route | callback endpoint |
| `eligibility` | reads the four source flows; never approves anything itself |
| `provisioning` | turns an existing profile payout destination into a verified `PayoutAccount` |
| `ledger` | the shared state machine; the only writer of `PAID`/`FAILED` |
| `fingerprint` | approval + batch integrity hashes |
| `riskScoring` | takeover-vs-onboarding signals before batching |
| `batching` | formation, authorization, separation of duties, submission |
| azampay client | HTTP contract only |
| `checksumInput` | provider-confirmed field composition |
| batch worker | submits authorized batches; resumes interrupted ones |
| reconcile worker | stale PROCESSING recovery |

There is no `guard.ts`. It existed to stop the legacy per-domain "mark paid" buttons from double-paying a source that was already in the disbursement ledger, but every one of those manual arms has since been retired (`admin.owners.ts`, `admin.tourRevenue.ts`, `admin.drivers.ts`, `admin.sales.finance.ts` all carry a comment saying so), leaving the module with zero call sites. The double-payment risk it covered is now enforced by the unique index on `activeSourceKey` instead.

This structure also makes it easy to add another payment/disbursement provider later without rewriting NoLSAF's payout policy and ledger.

---

## Sandbox test matrix

Test both happy-path execution and ambiguous provider outcomes before production.

| Test | Expected NoLSAF result |
|---|---|
| Generate token with valid credentials | Token cached, secret never logged |
| Generate token with invalid secret | Controlled AUTH error, no payout mutation |
| Name Lookup valid destination | Account name saved + `verifiedAt` |
| Name Lookup invalid provider/account | Verification fails, payout disabled |
| Disburse approved payout | `pgReferenceId` saved, status PROCESSING |
| Duplicate `externalReferenceId` | No second payout, reconcile original |
| Invalid BankName | Validation error, requires data/provider correction |
| Expired request | Rebuild freshness/checksum safely |
| Success callback | Exactly one PAID transition + ledger posting |
| Duplicate success callback | No duplicate accounting effect |
| Failure callback | FAILED, no automatic second payout |
| No callback | Status API eventually reconciles |
| Amount/reference mismatch callback | Freeze + security/manual review |
| Server restart during processing | State survives, reconciliation resumes |

Exit criterion: zero scenario can create an untracked or duplicate partner payment.

---

## Production readiness gate

A concise checklist before switching `AZAMPAY_ENV=production` for disbursement.

- **Credentials**: production app/client credentials issued and stored in secret manager.
- **Callback**: production HTTPS callback registered + authentication control confirmed.
- **Endpoint**: production disbursement/auth hosts confirmed by AzamPay.
- **DB**: unique refs, idempotent events, ledger transaction, and status constraints migrated.
- **Checksum**: field order + public key + test vector confirmed.
- **Operations**: admin approval, reconciliation, failure handling, and audit visibility ready.
- **Providers**: enabled MNO/bank values documented for NoLSAF.
- **Testing**: sandbox matrix passed with evidence and provider references.
- **Currencies**: TZS/USD capability documented, unsupported rails hidden in UI.
- **Monitoring**: alerts for FAILED / stale PROCESSING / callback errors.

**Release authority, verified before launch.** Confirm before go-live:

- **Every admin who can release a batch has a working email or phone on their user record.** Self-release is impossible without one — `issueBatchReleaseChallenge` refuses in production rather than falling back to an unauthenticated release. Send a test challenge and confirm it arrives, before there is money in a batch.
- Releasing your own batch without a code is refused (`403`, `challengeRequired: true`), and a code issued for one batch is rejected on another.
- Clearing a security hold on a payout you approved is refused.
- If a second finance admin exists, set `DISBURSEMENT_REQUIRE_TWO_PERSON=true` and verify self-release is refused outright. This is the stronger control and should be adopted as soon as staffing allows.
- `AZAMPAY_DISBURSE_MAX_AMOUNT` (per payout) and `AZAMPAY_DISBURSE_MAX_BATCH_TOTAL` (per authorization) are both set to real figures. Without the batch ceiling, `formBatch` sweeps every approved payout in the system into one batch and a single click releases it.
- `AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS` and/or `AZAMPAY_DISBURSE_CALLBACK_SECRET` is configured — the callback endpoint fails closed in every environment without at least one, but confirm it rather than relying on the refusal.
- `PAYOUT_RISK_TIMEZONE` matches the operating timezone if the host is not on East Africa Time.
- Background workers are running on exactly one instance (`workers/leaderLock.ts` holds the lease). The batch worker is what actually submits authorized money; if it is not running, batches sit `AUTHORIZED` and nothing is paid.

**Recommended release sequence**: MNO/TZS first -> stable reconciliation -> confirmed bank payouts -> confirmed USD payouts. Keep each rail feature-gated.

Document review date: 07 August 2026. Re-check the documentation and AzamPay merchant instructions before any future material integration change.

**NoLSAF engineering principle**: own the payout logic, let payment providers supply the rails.
