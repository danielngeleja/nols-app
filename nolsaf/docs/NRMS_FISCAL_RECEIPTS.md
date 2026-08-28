# NRMS Fiscal Receipts (TRA VFD): Owner-Activated Tax Receipting

Status: Written 2026-08-28. TRA contract researched 2026-08-28, see section 4; six items remain open with TRA, one of which (4.3(2)) can invalidate the whole approach.

Milestones 1, 2 and 4 BUILT AND WIRED 2026-08-28, uncommitted on `staging`. Migrations `20260828090000_add_nrms_fiscal_receipts` and `20260828171000_harden_nrms_fiscal_security` are APPLIED to the local Railway dev DB. Staging and production have NOT run them.

- `apps/api/src/lib/nrmsFiscal.ts`: classification, ledger source keys, calendar-day derivation, transactional counter allocation, enqueue, burn, backoff, and the `fiscaliseSettlement` hook.
- `apps/api/src/workers/nrmsFiscalDelivery.ts`: leased, idempotent FIFO per-property delivery, retry, dead-letter, escalation clock. Registered in `workers/index.ts`.
- Four settle sites call the hook: outlet payment settle (`nrmsOrders.ts`), reservation folio payment (`owner.nrms.reservations.ts`), and both master folio payment paths (`owner.nrms.agents.ts`, `owner.nrms.groupBlocks.ts`).
- Night audit reports `FISCAL_RECEIPTS_PENDING` as a **warning**, never a permanent blocker: a tax service being unreachable must not stop a day closing, for the same reason it must not stop a hotel taking money. The first close request requires an explicit acknowledgement; actor, time, count and receipt snapshot are then stored in the immutable Night Audit and general audit log.
- Milestone 3: `apps/api/src/routes/owner.nrms.fiscal.ts` at `/api/owner/nrms/fiscal`, guarded by `blockImpersonated`, plus `FiscalReceiptsCard` in the Tax register tab (`/owner/nrms/finance?view=tax`). Secrets are never returned; TIN/VRN lock when the first fiscal number is allocated; credential and activation mutations are owner-only and transactionally audited; activation requires a validated certificate with a verified future expiry and schedules mode changes for the next business day rather than going live mid day.
- The scheduled on/off switch is landed by the delivery worker via `applyPendingFiscalDayTransitions`, **not** by `ensureBusinessDay`. That was the obvious home and the wrong one: `ensureBusinessDay` is reached from `assertNrmsBusinessDayWritable` on every financial write, so it would have put a lookup on every settle all day to catch a change that happens at most twice in a property's life.
- Full API suite green: 1078 passed, 1 skipped.

The TRA adapter is a documented interface that throws `TRA_ADAPTER_NOT_IMPLEMENTED`, so documents queue and nothing is ever marked confirmed without a real provider response. Since no property has a `NrmsFiscalConnection` row, every one of these paths is currently a no-op that ends at a single indexed lookup returning null.
Owner: Daniel
Rule: no implementation begins until this document is reviewed and approved. Any scope change is edited here first, exactly as for NRMS_QR_ORDERING.md.

Decision already taken (2026-08-28): **the owner activates this themselves**. NoLSAF does not enroll as an integrator on behalf of properties, does not hold a shared platform registration, and is not the issuer of record. Every property that wants fiscal receipts registers with TRA under its own TIN and VRN, enters its own credentials into NRMS, and switches the feature on. This is the opposite of the channel-manager model in NRMS_MARKET_READINESS_PRIVATE.md section 2.1, and it is deliberate.

## 1. The problem

A hotel in Tanzania that is VAT registered must issue a fiscal receipt. NRMS today cannot, so the hotel keeps its EFD machine on the counter and re-keys every folio settlement and every bar bill into it by hand. That is the same "second manual gap" the market-readiness document says the whole NRMS thesis is built on removing (section 2.2). We removed it for channel managers. We have not removed it for the tax machine that every guest actually stands and waits for.

`allocateReceiptNumber` in `apps/api/src/lib/documentSequence.ts` already says this out loud in its own header: the series is unique and monotonic but **not gapless**, which is the right trade for a commercial receipt and the wrong one for a fiscal series. That comment is the honest statement of where we are.

## 2. Why it must be optional

Most properties in our target segment are guesthouses below the VAT registration threshold. They are not required to issue fiscal receipts, and forcing fiscalisation on them would make NRMS unusable for the majority of our own market. The feature is therefore **off by default for every property, forever**, and nothing about today's behaviour changes for a property that never touches it.

Three modes, because the market has three:

| Mode | Behaviour | Who it is for |
|---|---|---|
| `OFF` (default) | Commercial receipt only, exactly what NRMS does today | Non-VAT-registered properties. No change whatsoever. |
| `ON_REQUEST` | Staff press "Issue fiscal receipt" on a settled bill, including a bill from an earlier closed day | Properties that fiscalise only when a guest asks, which is common |
| `ALWAYS` | Every qualifying settlement fiscalises automatically | VAT-registered hotels that want the EFD machine gone |

## 3. Scope boundary

NRMS **is**:
- a recorder and transmitter of the property's own sales, on the property's own TRA registration;
- the holder of the property's credentials, encrypted, never displayed back;
- the place the returned fiscal receipt number and verification data are stored against the payment.

NRMS **is not**:
- the taxpayer, the issuer of record, or a party to the property's TRA relationship;
- an accounting system, a VAT return filer, or a tax adviser;
- responsible for the property's compliance.

This is the same posture already taken on hotel-direct money in market-readiness item 11 ("NRMS remains a recorder for hotel-direct money and does not falsely present itself as merchant of record"). The wording should be reused, not reinvented.

The owner accepts this as an explicit acknowledgement at activation, stored with timestamp and accepting user id. It is not a checkbox we can skip.

## 4. What the TRA integration actually requires

Researched 2026-08-28. **Source caveat that governs this whole section:** TRA does not publish a developer specification openly on tra.go.tz. The authoritative document is issued to a taxpayer as part of registration. Everything below comes from the community-maintained developer documentation at [tra-docs.netlify.app](https://tra-docs.netlify.app/guide/api/), the open-source Go implementation [Golang-Tanzania/tra-vfd](https://github.com/Golang-Tanzania/tra-vfd), and vendor write-ups. It is good enough to design against and **not** good enough to certify against. The first pilot property must obtain the official specification at registration, and milestone 4 must be validated against that document, not against this one.

### 4.1 Confirmed shape

**Registration** is one-time, per taxpayer. The business needs its TIN, its VRN certificate and an application letter, and reportedly takes about two working days. TRA returns a registration ID (`REGID`), a receipt code, credentials for token requests, and a certificate whose private key signs every subsequent document. All of it must be persisted by the taxpayer's system.

**Authentication** is a password grant: form-encoded `username`, `password`, `grant_type=password` against the token endpoint, returning an access token with an expiry in seconds. Tokens are cached and refreshed only when expired, and validity is checked before every post.

**Documents are XML and signed**: PKCS12, SHA-1 with RSA, base64 encoded, applied to the `REGDATA`, `RCT` and `ZREPORT` sections. SHA-1 is weak, and it is what the specification mandates, so we implement it as specified rather than improving on it.

**Endpoints** (test server, as published): registration `/efdmsRctApi/api/vfdRegReq`, token `/efdmsRctApi/vfdtoken`, receipt `/efdmsRctApi/api/efdmsRctInfo`, Z report `/efdmsRctApi/api/efdmszreport`, verification `/efdmsRctVerify/`. Production base URLs are issued at registration and are not published.

**The receipt carries** date, time, TIN, registration ID, serial number, customer details, receipt number, daily counter, global counter, per-item lines (id, description, quantity, tax code, amount), totals, tax breakdown and payments.

**A daily Z report is an obligation**, carrying header data, transaction totals, VAT breakdown, payment methods, and any change to VAT rates or header text since the previous report. It is driven by the taxpayer's system, so it is our worker to run, not something TRA pulls.

### 4.2 Four findings that change this specification

**(a) We own the numbering, not TRA.** The taxpayer's system generates the receipt number and both counters. The rules are strict: the global counter starts at 1, never resets, and must always equal the receipt number; the daily counter resets at midnight; no two receipts may share a number; no future dates. A cancelled transaction's number is burned, and the next transaction takes the next number rather than reusing it, so the series tolerates gaps from cancellation but nothing else. This is exactly the "allocated inside the committing transaction plus an explicit void register" that `documentSequence.ts` describes as what a fiscal series would need. Section 8 is corrected accordingly.

**(b) The fiscal day is the calendar day, and it is not our business day.** The daily counter resets at midnight and the Z report covers a calendar day. `NrmsBusinessDay` is an operating day that routinely runs past midnight, with night audit at 02:00 or 03:00. These are two different clocks and must never be conflated. Activation still gates on the business day (section 7.3), because that is the operational switch, while counters and Z reports run on the calendar day.

**(c) The offline rule is TRA's own, and it matches rule 7.1 exactly.** The specification instructs a taxpayer's system to keep generating transactions when TRA is unreachable, to record each one as success or pending, to keep testing the connection, and to resend everything pending **in order** once it returns. Rule 7.1 is therefore not our invention or a risk we are taking, it is the prescribed behaviour. The one constraint it adds: delivery is strictly FIFO per property. The outbox worker must not process a property's queue in parallel or out of sequence.

**(d) We generate the verification QR, TRA does not.** The QR encodes a verification URL of the form `https://virtual.tra.go.tz/efdmsRctVerify/<RCTVNUM>`. `nrmsOrderPoints.ts` already generates QR PNGs with the `qrcode` package for order points, so this is a reuse, not new work.

### 4.3 Still to confirm with TRA directly

1. **Refunds and credit notes.** The available documentation covers cancellation only to the extent of saying a cancelled number is not reused. It describes no credit-note document. Section 8 is written on an assumption and is the largest open risk in this specification.
2. **Whether a hotel may integrate its own software directly.** The evidence points that way (the taxpayer applies through EFDMS with TIN, VRN and a letter), but TRA also lists approved VFD suppliers who "act as intermediaries" for updates and maintenance. If direct integration by the taxpayer's own chosen software is not permitted, the owner-activated model in this document does not survive and the decision of 2026-08-28 has to be revisited. **Confirm this before anything else.**
3. Production endpoint URLs, issued at registration.
4. Whether a receipt may be submitted for a sale that occurred on an earlier calendar day, and which date it must then carry. This governs decision 1 in section 15.
5. Rate limits, payload size limits, and any required retry cadence.
6. Certificate lifetime and the renewal procedure, which section 9 must support.

Until item 2 is answered, build only the provider-neutral layer (sections 5, 6 and 7) and leave the adapter unimplemented behind the connection status. Items 1 and 4 must be answered before milestones 4 and 5.

## 5. Data model

New models, provider-neutral in shape so a second fiscal regime (Kenya, Uganda) can reuse the layer without a rewrite.

### `NrmsFiscalConnection`
One per property. Absence means the feature has never been touched, which is the state of every property today.

- `propertyId` unique
- `regime` VarChar, default `TZ_TRA`
- `mode` VarChar: `OFF`, `ON_REQUEST`, `ALWAYS`
- `status` VarChar: `DISABLED`, `PENDING`, `VALIDATED`, `ACTIVE`, `FAILED`, `SUSPENDED`
- `tin`, `vrn`, `businessName`, `taxOffice` (identity, not secrets)
- registration results returned by TRA: `regId`, `receiptCode`, `serialNumber`
- fiscal counters, per section 8.1: `globalCounter` (never resets), `dailyCounter`, `dailyCounterDate` (calendar date the daily counter belongs to)
- `lastZReportDate`, the last calendar day successfully reported
- `activatesOnBusinessDayId` and `deactivatesOnBusinessDayId`, nullable, see section 7.3
- `lastSuccessAt`, `lastErrorAt`, `lastError`
- `acknowledgedAt`, `acknowledgedById`, `acknowledgementVersion`
- audit timestamps

### `NrmsFiscalCredentialVersion`
Copy the shape of `ChannelCredentialVersion` (`prisma/schema.prisma:5060`) rather than inventing a second credential pattern: `version`, `status` STAGED/ACTIVE/REVOKED, `encryptedData`, `validationStatus`, `validatedAt`, `validationError`, `activatedAt`, `revokedAt`, `createdById`. Secrets are never returned by any endpoint, matching the existing channel behaviour.

`encryptedData` holds more than a password here (finding 4.1): the token-grant username and password, **and** the PKCS12 certificate bundle plus its passphrase, since every document is signed with that private key. Certificates expire, so this model also carries `expiresAt` and the health strip warns before it lapses. Renewal procedure is open item 4.3(6).

### `NrmsFiscalReceipt`
The record of one fiscalisation attempt and its result.

- `propertyId`, `connectionId`
- `ledgerTransactionId` and `sourceKey` (see section 6), `sourceKey` unique per property for idempotency
- `kind` VarChar: `RECEIPT`, `CREDIT_NOTE`
- `status` VarChar: `PENDING`, `SENT`, `CONFIRMED`, `FAILED`, `ABANDONED`
- `attemptCount`, `nextAttemptAt`, `lastError`
- returned data: `fiscalReceiptNumber`, `verificationCode`, `verificationUrl`, `signature`, `issuedAt`, `rawResponseDigest`
- `currency`, `grossAmount`, `taxAmount`, `taxBreakdown` Json
- `saleOccurredAt`, the moment the money actually moved, which is not the same as `issuedAt` when a receipt is issued late (see decision 1 in section 15)
- `replacesReceiptId` nullable, for credit notes
- audit timestamps

Raw provider payloads are **not** stored durably, only a digest, matching the decision already taken for Expedia reservations in market-readiness item 4.

### Migration
`20260828090000_add_nrms_fiscal_receipts` plus the forward-only `20260828171000_harden_nrms_fiscal_security`; both are applied only to the local disposable development database and remain unapplied to staging/production pending the normal release gates.

## 6. What triggers a fiscal receipt

NRMS already has one identity for every money movement: the `sourceKey` on `NrmsLedgerTransaction` (`prisma/schema.prisma:5783`), a deterministic string like `PAYMENT:{propertyId}:{paymentId}` or `OUTLET:{propertyId}:{orderId}`. That key is the idempotency anchor.

**Correction found while building (2026-08-28):** the ledger rows themselves are not written at settle. `owner.nrms.finance.ts` derives the postings over a date window during night audit, from the payment and order records. So the ledger is the right identity and the wrong clock. A guest standing at the counter cannot wait for night audit.

The trigger is therefore the settle itself (outlet order settle, folio payment recorded, master folio payment recorded), and it computes the same deterministic `sourceKey` without needing a ledger row to exist yet. The two meet later: night audit gains a consistency check that every fiscalisable posting in the day has a receipt carrying the same `sourceKey`. One identity, two systems, reconcilable by construction.

Fiscalisable source types:

| `sourceType` | Produces |
|---|---|
| `OUTLET_SALE` | receipt (bar and restaurant, walk-in and QR alike) |
| `FOLIO_PAYMENT` | receipt (reservation folio settlement) |
| `MASTER_FOLIO_PAYMENT` | receipt (group and agent master folio settlement) |
| `OUTLET_SALE_REVERSAL` | credit note against the original receipt |
| `PAYMENT_REVERSAL` | credit note |
| `MASTER_FOLIO_PAYMENT_REVERSAL` | credit note |

Everything else on that list (`ROOM`, `FOLIO_CHARGE`, `PLATFORM_FEE`, `OPERATING_EXPENSE`, `OWNER_INVOICE` and so on) is an internal accrual, not a sale to a guest, and is never fiscalised.

Consequence worth stating plainly: posting a bar order to a room folio is not a taxable sale event, the guest paying the folio at checkout is. Fiscalising on `FOLIO_PAYMENT` rather than on `FOLIO_CHARGE` is what keeps that correct, and it falls out of the ledger design for free.

## 7. The four rules

### 7.1 Fiscalisation never blocks a settle
If TRA is unreachable, the line is down, or the credentials have expired, the guest still pays and still leaves. The receipt is queued and retried. A tax service outage must never be able to stop a hotel taking money.

Implementation is the outbox pattern already proven in the channels layer: the `NrmsFiscalReceipt` row is created `PENDING` inside the same transaction that writes the ledger transaction, and a worker delivers it. Leases, backoff and dead-lettering copy `ChannelOutboundDelivery`.

This is confirmed, not assumed (finding 4.2(c)). TRA's own instruction is to keep generating transactions while offline, record each as success or pending, and resend the pending ones in order when the connection returns. Rule 7.1 is the prescribed behaviour rather than a liberty we are taking.

One constraint follows from it: **delivery is strictly FIFO per property**. A property's queue is drained in sequence, never in parallel and never out of order, because the counters embedded in each document are sequential. Cross-property parallelism is fine. This differs from `ChannelOutboundDelivery`, where deliveries are independent, so the lease logic can be copied but the concurrency model cannot.

Every receipt carries an immutable UUID submission key. The worker atomically claims the FIFO head with a finite lease and passes that stable key to the regime adapter as its provider idempotency/reconciliation key. A second worker, an unexpired `SENDING` head, a failed head still in backoff, or a dead letter all stop the queue; none can be skipped. Suspension or credential revocation clears the lease so an in-flight confirmation can no longer commit after the connection is fenced.

### 7.2 The folio is never mutated
A fiscal receipt is a record attached to a payment, not a change to it. `NrmsFiscalReceipt` points at the ledger transaction. No column on the folio, the order, or the payment changes meaning. The immutable financial record stays immutable, and a property that switches fiscalisation on mid-life has no retroactive effect on anything already settled.

### 7.3 Activation and deactivation happen at a business day boundary
A fiscal series is a gapless numbered sequence with a daily close. If an owner flips the toggle at 15:00, the day ends with half its settlements fiscalised and a broken series.

NRMS already owns the concept: `NrmsBusinessDay`. Switching on sets `activatesOnBusinessDayId` to the next day to be opened, and the connection becomes `ACTIVE` when that day opens. Switching off is symmetric and takes effect at the close of the current day, so the day closes complete. Never retroactive in either direction. Night audit gains a check that no `PENDING` fiscal receipt exists for the day being closed, and refuses to close silently over one.

**Two clocks, and they must not be conflated** (finding 4.2(b)). The business day is operational and routinely runs past midnight, with night audit at 02:00 or 03:00. TRA's daily counter resets at midnight and the Z report covers a calendar day. So: activation and deactivation gate on the **business** day, because that is the operational switch an owner is throwing; counters and Z reports run on the **calendar** day, because that is what TRA validates. A sale rung at 01:30 belongs to yesterday's business day and to today's fiscal day, and both statements are true at once. Any code that assumes one date field can serve both is wrong.

### 7.4 Failure is loud, and it gets louder
A property that switched fiscalisation on and is now failing must know within minutes, not at the end of the month. Pending and failed counts appear on the owner's NRMS surface with the same prominence as an unresolved channel issue. Expired or rejected credentials never degrade quietly into commercially-numbered receipts presented as fiscal ones.

Rule 7.1 keeps money moving, but it must not become permission to stay broken. Credentials that expire on Monday morning and go unnoticed until Thursday mean three days and several hundred settlements with no fiscal receipt, which is a worse outcome than not offering the feature. So the alarm escalates on a ladder, and never at any rung blocks a payment:

| Elapsed | Behaviour |
|---|---|
| First failure | Receipt queues and retries. Health strip shows the error. |
| Still failing at the end of the current cashier shift | Banner on every NRMS screen for the property, durable notification to the owner, not dismissable while the connection is `FAILED`. |
| Night audit for the day | Refuses to close quietly over pending fiscal receipts (already required by 7.3). The operator must acknowledge the backlog explicitly, and that acknowledgement is audited. |

A compliance feature that fails silently is worse than an absent one. The threshold is the shift rather than a fixed clock because the shift is the unit a property already works in, and `NrmsCashierShift` already marks it.

## 8. Numbering, voids and refunds

### 8.1 The counters are ours to maintain
Corrected by finding 4.2(a). NRMS generates the receipt number and both counters per property, and TRA validates them. The rules are not negotiable:

- global counter starts at 1, never resets, and always equals the receipt number;
- daily counter resets at midnight, on the **calendar** day, not the NRMS business day;
- no two receipts of one property ever share a number;
- no future dates;
- a cancelled transaction burns its number. The next transaction takes the next number, never the burned one.

So the series tolerates gaps caused by cancellation and nothing else. That means allocation must happen inside the committing transaction, which is precisely what the `documentSequence.ts` header says a fiscal series would require and what the commercial `RCPT/` series deliberately does not do. Do not reuse `allocateSequenceValue` for this: it is scoped globally, not per property, and it allows a number to be burned by an ordinary failure. Fiscal counters live on `NrmsFiscalConnection`, are allocated under a row lock in the same transaction that writes the ledger transaction, and every allocation produces a `NrmsFiscalReceipt` row so that a burned number always has a recorded reason.

### 8.2 Voids and refunds
A fiscal receipt is never deleted or edited. A reversal produces a `CREDIT_NOTE` row referencing the original via `replacesReceiptId`, driven by the reversal `sourceType`s in section 6, and NRMS's existing void-with-reason controls stay exactly as they are.

**This part is an assumption, not a confirmed contract.** The available documentation describes no credit-note document and addresses cancellation only by saying the number is not reused. Open item 4.3(1). If TRA has no credit-note concept, the likely shape is a second receipt carrying negative amounts, which the model above already accommodates by changing what the adapter serialises rather than what NRMS stores. Do not build milestone 5 until this is answered.

## 9. Credential security

We are now holding another party's tax credentials, so the bar goes up, not down.

- Encrypted at rest, in `NrmsFiscalCredentialVersion`, separate from ordinary property data.
- Never returned by any endpoint, owner or admin. The channels code already refuses this; copy it.
- Browser-supplied certificate expiry is ignored. Validation derives expiry from the signed certificate; activation fails closed when that verified date is absent or expired.
- Owner-triggered rotation (stage, validate against a test call, then activate atomically) and revocation, both audited.
- Per-property blast radius. There is no shared NoLSAF secret to leak, which is a genuine advantage of the owner-activated model over the integrator model.
- Credentials and raw provider payloads are excluded from logs and from durable operational records.
- Guard the activation, rotation and revocation endpoints with `blockImpersonated`, consistent with the impersonation rule applied to every other credential surface.

## 10. Admin oversight

Admin observes, admin does not approve. There is no gate for a property to pass, because NoLSAF is not a party to the registration.

- The admin NRMS directory shows which properties have fiscal mode on, in which mode, and the connection health.
- Failing and stale connections appear in the existing NRMS health and integrity surfaces.
- Admin can `SUSPEND` a connection when something is clearly wrong, using the established enforcement pattern: reason required, `adminAudit` entry, owner notified, `requireFinanceGrant` where the action touches money surfaces.
- Admin can never read a credential, issue a receipt, or void one on a property's behalf. "Admin oversees, never operates" is the existing principle and it holds here without exception.

## 11. UI surfaces

Owner and manager:
- A **Fiscal receipts** card in the **Tax register** tab, `/owner/nrms/finance?view=tax` (decision 4, section 15). Owners and managers can observe health and issue/retry receipts; only the owner can change taxpayer identity, credentials, activation or deactivation.
- Off, with a plain explanation of who this is for and who it is not for, and no nagging for the property that will never use it.
- Activation wizard: identity (TIN, VRN, business name), credentials, test call, acknowledgement, mode selection, "takes effect when tomorrow's business day opens".
- Health strip: last success, pending count, failed count, last error, retry control. The escalation banner from 7.4 appears property-wide, not only on this page, because an owner who broke fiscalisation will not be sitting on the policy page when it happens.
- On a settled bill: the fiscal receipt number and verification data when confirmed, a pending indicator when queued, and in `ON_REQUEST` mode an "Issue fiscal receipt" action, available on past bills too.

Guest-facing:
- The printed receipt (see the printing work, which shares the template pipeline) carries the fiscal number, verification code and verification QR whenever the property is fiscalising, always, with no owner toggle to suppress it (decision 3, section 15). It carries none of it when the property is `OFF`. One template, two states, no second document type.

## 12. Build milestones

Each is independently shippable and none of them changes behaviour for a property in `OFF`.

| # | Milestone | Contents | Depends on |
|---|---|---|---|
| 0 | Close open item 4.3(2) | Confirm with TRA that a taxpayer may integrate its own software directly. Everything below is void if the answer is no. | nothing |
| 1 | Provider-neutral fiscal layer | **BUILT.** Three models, migration prepared, connection lifecycle fields, acknowledgement capture | 0 |
| 2 | Fiscal counters | **BUILT.** Per-property transactional allocation, calendar-day daily reset, burn register (section 8.1) | 1 |
| 3 | Owner activation flow | **BUILT.** `owner.nrms.fiscal.ts` (identity, credential staging, validation, activate, deactivate, revoke) plus the Fiscal receipts card in the Tax register tab. Day-boundary promotion runs in the delivery worker. | 1 |
| 4 | Receipt pipeline | **BUILT AND WIRED.** Settle hook on four sites, leased/idempotent FIFO per-property worker registered, retries, dead-letter, sanitized public errors, escalation clock, and explicit audited night-audit backlog acknowledgement. | 1 and 2 |
| 5 | TRA adapter | XML build, PKCS12 signing, token cache, registration, receipt post. Validated against the official specification obtained at registration, not against this document. | 0 and 4 |
| 6 | Z report worker | Daily calendar-day report per fiscalising property, retry, gap detection against `lastZReportDate` | 5 |
| 7 | Credit notes | Reversal-driven. **Blocked on open item 4.3(1).** | 5 |
| 8 | Print integration | Fiscal fields, verification code and generated QR on the receipt template, reusing the `qrcode` path from `nrmsOrderPoints.ts` | 5 and the printing work |
| 9 | Admin observation and suspend | Directory column, health, audited suspend | 3 |

Milestones 1 through 4 are regime-neutral, are most of the work, and can proceed as soon as milestone 0 comes back yes. The adapter and everything after it wait for the official specification.

## 13. Testing requirements

- A property in `OFF` behaves byte-identically to today. This is the regression that matters most.
- Idempotency: replaying the same `sourceKey` never issues two fiscal receipts.
- Concurrency: simultaneous settlements do not interleave into a duplicate or a skipped receipt.
- Outage: provider unreachable, provider slow, provider returning a malformed body. Settlement completes in all three, receipt queues, retry succeeds later.
- Credential expiry mid-day: fails loudly, never silently produces a commercial receipt presented as fiscal.
- Activation at 15:00 does not fiscalise the day already in progress.
- Deactivation closes the current day complete.
- Night audit requires explicit acknowledgement before closing a day holding pending fiscal receipts, and stores the actor, time, count and receipt snapshot.
- Late issue: a receipt raised on Wednesday for a Monday sale carries both dates and alters nothing in Monday's closed totals.
- Escalation ladder: a failure surviving a shift boundary raises the banner and the owner notification, and no rung of the ladder ever refuses a settlement.
- Reversal produces exactly one credit note against the correct original.
- Counters: global counter equals the receipt number and never resets; daily counter resets at calendar midnight and not at business-day close; a sale rung at 01:30 lands in yesterday's business day and today's fiscal day.
- A cancelled transaction burns its number, the next transaction takes the next number, and the burn is recorded with a reason.
- FIFO: a property's pending queue is resent strictly in order after an outage, and two workers never drain one property concurrently.
- Certificate approaching expiry warns before it lapses, and an expired certificate fails loudly per 7.4.
- Tenant isolation: a property can never read or use another property's credentials, certificate, counters or receipts.
- Credentials absent from every log, every API response, and every durable operational record.

## 14. Out of scope

- NoLSAF acting as an approved integrator for any property. Decided against, 2026-08-28.
- VAT return preparation or filing.
- Accounting connectors. Still deferred, per market-readiness item 16.
- Any second fiscal regime. The layer is shaped so one can be added, but none is being built.
- Retroactive fiscalisation of settlements that predate activation.

## 15. Decisions (all settled 2026-08-28 by Daniel)

**1. Late issue is allowed.** `ON_REQUEST` can issue a fiscal receipt for a bill settled on an earlier, already closed business day. A guest returning two days later for a company receipt is normal, and a system that cannot serve them will be worked around by hand. The receipt records both `saleOccurredAt` and `issuedAt`, so the closed day's totals are never touched and the two dates stay distinguishable on the document and in reporting.

Constrained by the 2026-08-28 research: TRA forbids future dates and drives its counters off the submission day, so a Wednesday-issued receipt for a Monday sale almost certainly carries Wednesday's fiscal date, Wednesday's daily counter, and lands in Wednesday's Z report. Our `saleOccurredAt` keeps the internal truth. The decision stands; exactly which date TRA expects on the document is open item 4.3(4).

**2. The alarm escalates, and never blocks.** A failing connection in `ALWAYS` mode does not stop settlements at any point. It does stop being quiet: error on the health strip immediately, an undismissable property-wide banner plus a durable owner notification once the failure survives the end of the current cashier shift, and a night audit that will not close over pending receipts without an explicit audited acknowledgement. Full ladder in section 7.4.

**3. The verification QR always prints.** Whenever the property is fiscalising, the code and QR go on the receipt. No owner toggle to suppress it. It costs nothing, it is the reason the receipt exists, and an option to hide it is a conversation we should not be having with owners.

**4. The card lives in the Tax register tab, `/owner/nrms/finance?view=tax`.** Superseded twice: first `/owner/nrms/controls` was proposed, then Daniel chose `/owner/nrms/policy`, then on seeing the built screen he pointed out that a **Tax register** nav item already exists under Finance & Night Audit with the OWNER/MANAGER operational visibility the feature needs. The owner alone controls taxpayer identity, credentials and activation; managers retain read, issue and retry access. That is the right home and the earlier two are dropped. The policy page was never in the sidebar at all (reachable only from a "Policies" footer link), so it would have left the feature undiscoverable until it broke. The acknowledgement is still captured at activation and recorded on the connection; it does not need to sit beside the terms to bind. The 7.4 escalation banner stays property-wide in the NRMS shell and is not confined to any one page.
