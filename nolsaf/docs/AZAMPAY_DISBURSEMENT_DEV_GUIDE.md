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

The disbursement callback route has a known, unresolved gap: AzamPay's docs do not publish a signature field for the callback payload, so the route can only enforce an optional IP allowlist (`AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS`) plus content matching (externalReferenceId + amount) against the stored Disbursement. This is not a finished security control — see the "Questions NoLSAF must send AzamPay before production" list.

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

States: `REQUESTED -> VERIFIED -> APPROVED -> SUBMITTED -> PROCESSING -> PAID / FAILED`

**Reference strategy:**
- NoLSAF reference: `NLS-P-260807-9381`
- AzamPay `pgReferenceId`: e.g. `b42aeas4...cb452`
- FSP reference: received later in callback

**Rules:**
- `externalReferenceId` is required and max 30 characters.
- Make it unique in NoLSAF before calling AzamPay.
- Store `pgReferenceId` immediately after provider acceptance.
- Never identify a payout by amount alone.
- Callback processing must be idempotent.

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
  "externalReferenceId": "NLS-P-260807-9381",
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
  "initiatorReferenceId": "NLS-P-260807-9381",
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
- Which `bankName`/provider values are enabled for NoLSAF disbursement?
- Can the same API pay CRDB/NMB bank accounts? If yes, what exact values?
- Which currencies are supported for disbursement, including USD accounts?
- What values are valid for `transferDetails.type`?
- What is the callback authentication method and retry policy?
- Provide production base URL, source-account setup, limits, fees, and prefunding/settlement requirements.

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
      payoutEligibilityService.ts
      payoutLedgerService.ts
      payoutReconciliationService.ts
    azampay/
      auth.ts
      checksum.ts
      checksumInput.ts
      disbursementClient.ts
      errors.ts
  jobs/
    reconcileProcessingPayouts.ts

packages/prisma/schema.prisma
```

**Responsibilities**

| Component | Responsibility |
|---|---|
| `owner.payouts` | request + view partner payout |
| `admin.disbursements` | review / approve / reject / status |
| disbursement route | callback endpoint |
| payout services | business rules + balance + locking |
| azampay client | HTTP contract only |
| `checksumInput` | provider-confirmed field composition |
| reconcile job | stale PROCESSING recovery |

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

**Recommended release sequence**: MNO/TZS first -> stable reconciliation -> confirmed bank payouts -> confirmed USD payouts. Keep each rail feature-gated.

Document review date: 07 August 2026. Re-check the documentation and AzamPay merchant instructions before any future material integration change.

**NoLSAF engineering principle**: own the payout logic, let payment providers supply the rails.
