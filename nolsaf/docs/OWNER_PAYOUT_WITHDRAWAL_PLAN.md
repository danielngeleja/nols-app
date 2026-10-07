# Owner Payout Withdrawal: Plan and Engineering Flow

Status: agreed with Daniel on 2026-10-07. **Phase 1 backend built, uncommitted, migration NOT applied** (see section 12). Phases 2 to 5 are not built.

## 1. Goal

Replace the current owner payout process (owner clicks "claim", then an admin approves the invoice, approves the disbursement, forms a batch and releases it with an OTP) with:

1. A **date lock** that unlocks the owner's money a fixed time after a verified check-in.
2. An **owner-initiated withdrawal confirmed by OTP**, the way betting and wallet apps do it.
3. **Automatic release** of normal withdrawals, with admins handling only exceptions.

This honours promises the published policies already make: the owner disbursement policy offers an instant claim after code validation (section 5.1.1.1) and processing within 30 minutes to 24 hours of a claim (section 5.4.1). Today's four-click admin process breaks section 5.4.1 whenever no admin is available.

## 2. Agreed rules

| Rule | Decision |
|---|---|
| Unlock, mobile money or bank | `releaseAt = max(codeValidatedAt, start of check-in date in EAT) + 24h` |
| Unlock, any card payment on the booking | `releaseAt = checkout date in EAT + 24h` |
| Unknown payment channel (null) | Treated as card (stricter rule) |
| Why 24h | Cancellation policy section 3.2.5.1.6: a guest must report an uninhabitable property within 24h. This is also the Booking.com model (virtual card active from check-in + 1 day). |
| Owner's first payout ever | Always goes to the MANUAL lane (one admin look per new owner) |
| Automatic release allowed for | LOW risk, and MEDIUM where every flag is in {FIRST_PAYOUT_TO_BENEFICIARY, AFTER_HOURS_APPROVAL} |
| Everything else | MANUAL lane (existing admin flow, unchanged) |
| Withdrawal | Owner taps Withdraw, the OTP fires, the owner confirms, and the money moves |

## 3. Business flow (Amina example)

Amina books NoLSAF Hotel and pays by M-Pesa. Check-in is 07/10/2026; Daniel is the owner.

```
07/10 14:00  Daniel validates Amina's code        -> booking CHECKED_IN
             System creates claim + release        -> LOCKED, releaseAt 08/10 14:00 EAT
             Amina gets "Any problem? Report it"   -> 24h report window starts
             Daniel sees "TZS X unlocks 08/10 14:00"
08/10 14:00  Worker re-checks all gates           -> AVAILABLE
             Daniel notified "TZS X available to withdraw" (no code in this message)
08/10 any    Daniel taps Withdraw                  -> OTP fires to his verified phone
             Daniel enters OTP                     -> lane decided
             AUTO lane                             -> system approves, batches, sends
             Minutes later                         -> M-Pesa receives, receipt issued
```

Branches:

- Amina reports a problem before 08/10 14:00, or a cancellation, refund or dispute opens: **HELD**. An admin resolves it; money never moves while HELD.
- Card-paid booking: releaseAt becomes checkout + 24h, and everything else is the same.
- Daniel's first payout ever: after the OTP it goes to an admin once, then he is in the AUTO lane.
- High-risk flags, caps exceeded or the kill switch off: MANUAL lane after the OTP.

## 4. State machine

New entity `PayoutRelease`, one row per payout source (owner invoice now; drivers and tours can adopt it later).

```
                 hold signal                      admin clears
   LOCKED ───────────────────────► HELD ───────────────────────► LOCKED (new releaseAt)
     │                                │
     │ releaseAt reached               └── admin rejects / refund ─► CANCELLED
     │ AND gates pass
     ▼
   AVAILABLE ── owner OTP confirmed ──► WITHDRAWING ──► RELEASED (disbursement exists)
     │                                      │
     │ hold signal appears                  └── lane AUTO or MANUAL is recorded
     ▼
   HELD
```

Disbursement statuses after RELEASED are the existing ones (REQUESTED, APPROVED, BATCHED, AUTHORIZED, PROCESSING, PAID, FAILED, SECURITY_REVIEW). Nothing in that pipeline changes, except that a SYSTEM actor may approve and authorize AUTO-lane items under the caps in section 7.

### Hold signals (any one moves LOCKED or AVAILABLE to HELD)

| Signal | Source in code |
|---|---|
| Guest problem report | New report page, creates a `CancellationRequest` with a property-issue reason (reuses the cancellation workspace) |
| Open cancellation request on the booking | `CancellationRequest` (open statuses, to be confirmed in code) |
| Pending refund | `PaymentRefund` on the booking's payment intent |
| Open dispute or chargeback | `PaymentDispute`; also `REVERSED` intent status from the payments inbox |
| Payout account changed within the recent-change window | `PayoutAccount.destinationChangedAt` against `SystemSetting.payoutRecentChangeHours` (72h) |
| Booking no longer CHECKED_IN or checked out | Booking status |

## 5. Engineering flow

### 5.1 Check-in hook (creates the claim and the release)

Three code paths mark a check-in code USED, and all three must create the release:

- `apps/api/src/lib/bookingCodeService.ts` (~line 678, the owner desk validation)
- `apps/api/src/routes/admin.bookings.ts` (~line 791)
- `apps/api/src/routes/admin.helpOwners.ts` (~line 213)

Rules:

1. **Check-in must never fail because of payouts.** The hook runs **after** the check-in transaction commits, best effort, and logs on failure.
2. A **sweeper** in the release worker backfills any CHECKED_IN booking with a USED code and no release, so a failed hook or a fourth path we missed still converges.
3. Move the OINV invoice creation out of `owner.booking.ts` (~line 950) into a shared `ensureOwnerClaim(bookingId)` in `lib/`, used by the hook, the sweeper and the old route. It stays idempotent (find by invoiceNumber) and moves DRAFT to REQUESTED once.
4. `computeReleaseAt(booking, codeUsedAt, paymentChannels)`, a pure function:
   - channels = the SUCCESS `PaymentEvent.paymentChannel` values on the booking's `INV-` invoice
   - any `CARD`, or any null, means `CARD_CHECKOUT_24H`; otherwise `CHECKIN_24H`
   - all date math in `Africa/Dar_es_Salaam`; the result is stored with its rule name
5. Notify the guest (SMS plus in-app) with the report link, using an opaque `bk_` reference and never a row id.

### 5.2 Release worker (`workers/payoutRelease.ts`, leader-only, every 5 minutes)

Each pass:

1. **Backfill**: create missing releases (section 5.1, point 2).
2. **Hold scan**: LOCKED and AVAILABLE rows with any hold signal become HELD, with `holdReason` recorded and the owner notified.
3. **Unlock**: LOCKED rows with `releaseAt <= now` re-run the gates:
   - `loadEligiblePayoutSource` passes (collected money covers netPayable, netPayable is set and positive)
   - no hold signal
   - the owner has a verified, active, supported MOBILE_MONEY payout account
   - the guest is not the owner (user id, phone, email, and guest phone against the payout account number)

   If the gates pass the row becomes AVAILABLE and the owner is notified. If not, it becomes HELD with the reason.
4. **Unclaimed** (only if decision D2 is yes): AVAILABLE for more than `payoutUnclaimedAutoDays` becomes a system withdrawal to the verified, unchanged account (policy section 5.2.2).

Registered in `workers/index.ts` next to `startDisbursementBatchWorker`, behind the same `disbursementSenderEnabled` gate, plus the new kill switch.

### 5.3 Owner withdrawal with OTP

All three routes sit under `/api/owner/payouts` and are guarded by `blockImpersonated` (no withdrawal from an impersonated session).

**`GET /available`**: AVAILABLE releases with their total, LOCKED releases with countdowns, HELD releases with a plain reason, and the masked payout destination.

**`POST /withdraw/challenge`** `{ releaseRefs[] }` (opaque refs, not ids)

1. Load the releases. All must be AVAILABLE and belong to the caller.
2. Re-run the gates (state may have changed since the page loaded).
3. Compute a **challenge fingerprint**: sha256 of the sorted release ids, the total, the currency, payoutAccount.id, accountNumber and destinationChangedAt.
4. Create a `PayoutWithdrawalChallenge` with a code from `generate6()` (CSPRNG, `lib/otp.ts`), stored as a hash, expiring in 5 minutes, max 5 attempts.
5. Send the SMS to the owner's **verified phone**, stating the amount and the masked destination, for example: "NoLSAF code 123456 to withdraw TZS 180,000 to M-Pesa ***456. Never share this code."
6. Rate limit: 3 challenges per 15 minutes per owner.
7. Respond with the challenge ref, the masked phone and expiresAt. **The code is never returned.**

**`POST /withdraw/confirm`** `{ challengeRef, code }`

1. Inside one transaction: load the challenge, check it is not used, not expired and under 5 attempts, and verify the hash (increment attempts on a mismatch). Mark it used **in the same transaction** so two concurrent confirms cannot both spend it (the same pattern as `services/payouts/releaseChallenge.ts`).
2. Recompute the fingerprint from live data. If it doesn't match, reject; the owner starts again. This catches an account change or new hold between challenge and confirm.
3. Move the releases to WITHDRAWING.
4. For each release, outside the OTP transaction and idempotent:
   1. Invoice REQUESTED to APPROVED via a shared `approveOwnerInvoice(id, actor)` extracted from `admin.invoices.ts` line 443 (the same conditional claim; actor `SYSTEM`, reason `OWNER_WITHDRAWAL_OTP`).
   2. `requestDisbursement({ sourceType: "OWNER_INVOICE", ... })` (existing).
   3. **Lane decision** (section 6). AUTO calls `approveDisbursement(id, SYSTEM)` and sets `releaseLane = AUTO`; MANUAL leaves the disbursement REQUESTED with `releaseLane = MANUAL` and a reason the admin can see.
   4. The release becomes RELEASED, linked to the disbursement.
5. Respond with per-item results ("Sending now" or "Under review, usually within 24h").

### 5.4 Automatic batching (no change to the "every payout goes through a batch" rule)

`submitToAzamPay` only accepts AUTHORIZED items from a batch, and this plan keeps that. The release worker adds:

1. `formAutoBatch()`: the same body as `formBatch` (name-lookup reverify, approval fingerprint, risk scoring, SECURITY_REVIEW diversion), limited to `releaseLane = AUTO`, with `formedById = null` and `mode = AUTO`.
2. `authorizeAutoBatch(batchId)`: allowed only when
   - the kill switch is ON
   - every item is `releaseLane = AUTO` and still LOW or harmless MEDIUM after re-scoring
   - today's AUTO total plus this batch is within `autoPayoutDailyCapTzs`; anything over waits for the next day or is moved to MANUAL by an admin

   It writes an audit row with actor `SYSTEM` and the rules that passed. The OTP release challenge and separation of duties apply **only** to `mode = MANUAL` batches.
3. The existing `processAuthorizedBatches` worker submits to AzamPay unchanged, and the existing reconciliation and callback paths finish the job.

### 5.5 After payment

- Disbursement PAID updates the release and the invoice, emails the receipt (existing `ownerDisbursementReceiptNumber`) and updates the owner statement.
- Disbursement FAILED notifies the owner to fix the account, and the release returns to AVAILABLE once the account is verified again.
- A late refund (cancellation section 3.2, unused nights only) or chargeback after PAID creates a recovery debt (Phase 4), deducted from the owner's next releases. Policy section 6.3.3 allows this. The guest's refund is never delayed by the recovery.

## 6. Lane decision

```
first PAID disbursement for this owner?        yes -> MANUAL
risk HIGH or CRITICAL?                         yes -> MANUAL (existing SECURITY_REVIEW)
risk MEDIUM with flags outside the harmless set? yes -> MANUAL
amount >= payoutReviewThresholdTzs?            yes -> MANUAL
owner 24h total > payoutDailyCapPerPayeeTzs?   yes -> MANUAL
kill switch OFF?                               yes -> MANUAL
otherwise                                          -> AUTO
```

The global daily cap is applied at batch authorization (section 5.4), not here, so a busy day queues payouts instead of rerouting them.

## 7. Data model changes (one migration, prepared and NOT applied until Daniel approves)

It must run on both MySQL 8 (staging) and MariaDB 11.8 (prod), in house migration style.

| Change | Purpose |
|---|---|
| New table `payout_release` | sourceType, sourceId (unique pair), bookingId, ownerId, status, rule (`CHECKIN_24H`, `CARD_CHECKOUT_24H`, later `NO_SHOW`, `NONREFUNDABLE_CANCEL`), releaseAt, availableAt, holdReason, heldAt, releasedAt, disbursementId, lane, createdAt, updatedAt |
| New table `payout_withdrawal_challenge` | userId, releaseIds (JSON), fingerprint, codeHash, channel, destinationMasked, expiresAt, usedAt, attempts, createdAt |
| `disbursement.releaseLane` VARCHAR(10) NULL | AUTO or MANUAL (null = created before this feature) |
| `disbursement_batch.mode` VARCHAR(10) DEFAULT 'MANUAL' | Separates system batches from human batches |
| `systemsetting.autoPayoutEnabled` BOOLEAN DEFAULT false | Kill switch, **off by default** |
| `systemsetting.autoPayoutDailyCapTzs` INT NULL | Global AUTO-lane daily ceiling (null = AUTO lane cannot authorize) |
| `systemsetting.payoutUnclaimedAutoDays` INT NULL | Decision D2 (null = never auto-send without OTP) |

Prerequisite: migration `20261001090000` (payout safeguards) must be applied first, since this plan relies on its threshold and cap columns.

## 8. Screens

**Owner** (house components, no native date inputs, no em dashes in copy, "NoLSAF" casing):

- Payouts page: an "Available to withdraw" card with the total and a Withdraw button; an "Unlocking" list with a countdown in EAT; an "On hold" list with the reason and a support link; history with receipts.
- OTP modal: the amount, the masked destination, a 6-digit input, resend after 60s, and the expiry shown.

**Guest:** the check-in message links to `/account/bookings/<bk_ref>/report` with categories mapped to cancellation section 3.2.5. Submitting creates the CancellationRequest and holds the payout.

**Admin:**

- Settings: auto-payout switch, daily cap and unclaimed days, each change recorded and finance-OTP gated like the other payout safeguards.
- `/admin/disbursements`: a HELD queue, a MANUAL-lane queue with the reason each item is there, and an AUTO-lane audit view (who, what, which rules passed).

## 9. Delivery phases

| Phase | Scope | Exit check |
|---|---|---|
| 0. Prerequisites | Static egress IP allowlisted by AzamPay (see the AzamPay egress memory note); migration `20261001090000` applied | A production name lookup succeeds |
| 1. Date lock, shadow mode | Migration, check-in hook, sweeper, release worker (backfill, hold, unlock), owner countdown, guest report page. Withdraw still goes to the MANUAL lane only | 1 to 2 weeks of releases computed correctly against real check-ins |
| 2. OTP withdrawal | Challenge and confirm routes, OTP modal, MANUAL lane only | Owners withdraw; admins see OTP-confirmed requests |
| 3. AUTO lane | Lane decision, `formAutoBatch`, `authorizeAutoBatch`, admin settings; switch ON with a low daily cap | Automatic payouts reconcile to PAID; daily cap enforced |
| 4. Recovery | Recovery debt for post-payout refunds and chargebacks, deducted from future releases | Test refund after PAID nets correctly |
| 5. Extra branches | No-show and cancelled non-refundable bookings (decision D3) | Policy and code agree |
| Policy | Updated owner disbursement policy published with **21 days' notice** (policy section 12.1) before Phase 3 goes live | Notice sent |

## 10. Tests

- `computeReleaseAt`: EAT midnight boundaries, early validation (clock starts at the check-in date), validation after midnight, card / mixed / null channels, checkout + 24h.
- Hold scan: each signal holds; clearing returns to LOCKED; no AVAILABLE while any signal is open.
- Challenge: wrong code increments attempts; 6th attempt rejected; expired rejected; two concurrent confirms spend it once; an account change between challenge and confirm fails the fingerprint; a challenge for one set of releases cannot confirm a different set; impersonated session blocked; rate limit.
- Lane: first payout goes MANUAL; harmless MEDIUM goes AUTO; any other MEDIUM flag goes MANUAL; threshold and caps go MANUAL; kill switch off means no AUTO authorization.
- Daily cap: items beyond the cap stay unauthorized; the next day they proceed.
- Idempotency: confirm retried after a crash creates no second disbursement (the `activeSourceKey` unique already guarantees this).
- Check-in resilience: a failing hook never fails the check-in, and the sweeper creates the release later.

## 11. Open decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | When does the OTP fire? | **DECIDED 2026-10-07: when the owner taps Withdraw**, never at the moment money becomes available. The "available" notification carries no code. |
| D2 | Auto-send if the owner never withdraws? | **DECIDED: yes, after 14 days**, to the verified account, unchanged for 72h. This matches policy section 5.2.2, and the destination cannot be redirected without triggering a hold. |
| D3 | No-show and cancelled non-refundable payouts | **DECIDED:** No-show: the owner marks it after the deadline, the guest has 24h to dispute, card no-shows always go MANUAL. Non-refundable cancellation: unlock at check-in date + 24h. |
| D4 | OTP channel | **DECIDED:** SMS to the verified phone; email fallback only if SMS delivery fails. |
| D5 | Starting daily AUTO cap | **DECIDED: TZS 2,000,000 per day** for the first month, set in admin settings at Phase 3 (not hard-coded), raised after reconciliation is clean. |
| D6 | Guest report storage | **DECIDED:** reuse `CancellationRequest` with a property-issue reason (one admin workspace) rather than a new table. |

All decisions were taken on 2026-10-07 ("go with all the recommendations").

## 12. Implementation status

### Phase 1 backend (built 2026-10-07, uncommitted on `staging`)

| Piece | Where |
|---|---|
| Schema: `PayoutRelease`, `PayoutWithdrawalChallenge`, `Disbursement.releaseLane`, `DisbursementBatch.mode`, 3 `SystemSetting` columns | `prisma/schema.prisma` |
| Migration, prepared, **not applied** | `prisma/migrations/20261007090000_add_owner_payout_release/migration.sql` (matches the offline `prisma migrate diff` of the schema change) |
| Unlock rule, claim creation, decision logic | `apps/api/src/services/payouts/release.ts` |
| Worker (backfill + evaluate, every 5 min, leader only) | `apps/api/src/workers/payoutRelease.ts`, registered in `workers/index.ts` |
| Check-in hooks (after commit, never awaited) | `lib/bookingCodeService.ts` (owner desk), `routes/admin.helpOwners.ts` (admin on behalf) |
| Owner read API | `GET /api/owner/payouts/releases` in `routes/owner.payouts.ts` |
| Tests | `services/payouts/release.test.ts` (22 tests); full API suite green (1938 passed) |

Everything is behind **`PAYOUT_RELEASE_ENABLED`** (off by default): the hooks, the worker and the read API do nothing until it is set, so the code can deploy before the migration. Turn it on only after the migration is applied.

Behaviour in shadow mode:

- At check-in the owner claim is created as **DRAFT** (not REQUESTED), so the admin queue does not change. The owner's existing "send invoice" action still works as before.
- A claim paid through the old manual flow is detected and the release marked RELEASED, lane MANUAL.
- The backfill only covers check-ins from the last 7 days, so enabling the flag never reopens old, settled stays.

### Found and fixed during the build

- **Duplicate owner claim across months** (`routes/owner.booking.ts`, send-invoice): the existing claim was looked up by the month-stamped invoice number, so a click in a later month created a second claim for the same stay. Each claim passes the solvency gate on its own, so one stay could be paid twice. It now looks up by booking and the `OINV-` prefix, like `owner.invoices.ts` already did.

### Notes for later phases

- `routes/admin.bookings.ts` (~line 791) marks a code USED but sets the booking to CONFIRMED, not CHECKED_IN. No release is created there; one is created once the booking reaches CHECKED_IN (sweeper).
- Marketplace card **chargebacks are not recorded** anywhere today (marketplace `PaymentEvent` has no reversal status; `PaymentDispute` belongs to NRMS payment intents). Phase 4 needs that signal first.
- Owner countdown UI built: `apps/web/components/OwnerPayoutReleasesCard.tsx`, shown on `/owner/revenue` (My Payouts). It renders nothing while the flag is off.
- `REFUND_PENDING` added to the open cancellation statuses (the cancellation routes use it).
- **Guest check-in SMS: KEPT and built** (Daniel: "very protective"). `apps/api/src/lib/checkInConfirmationSms.ts` texts the guest at validation, from both check-in paths: "NoLSAF: Check-in confirmed at {property} on {time} EAT. If you have not checked in, call NoLSAF now on {support phone}." This is not behind the payout flag, so it is live on deploy. Tested in `checkInConfirmationSms.test.ts`.
- **Guest "report a problem" page: DROPPED (Daniel, 2026-10-07).** Day-to-day issues are settled between guest and owner; NoLSAF is not the judge of every action. D6 no longer applies. The 24h window stays as a settling period, and payouts are still held by the formal signals: open cancellation or refund requests (exceptional circumstances under cancellation policy section 3.2), a guest matching the owner, and booking status. Phase 1 is complete apart from the migration and the flag.
- Daniel applies migration `20261007090000` himself.

### Phase 2: OTP withdrawal, MANUAL lane (built 2026-10-07, uncommitted)

| Piece | Where |
|---|---|
| Service: challenge, delivery (SMS, then verified email), confirm | `apps/api/src/services/payouts/withdrawal.ts` |
| Routes (owner only, impersonation blocked by the router) | `POST /api/owner/payouts/withdraw/challenge`, `POST /api/owner/payouts/withdraw/confirm` |
| UI: Withdraw button, code entry, resend after 60s, cancel | `OwnerPayoutReleasesCard.tsx` on `/owner/revenue` |
| Tests | `services/payouts/withdrawal.test.ts` (16 tests); full API suite green (1957 passed) |

How it behaves:

- **Withdraw covers everything ready.** One code covers every AVAILABLE payout; each one is re-checked at that moment.
- **The code is bound to the withdrawal.** It is tied to the release ids, total and live destination (fingerprint), lasts 5 minutes, allows 5 attempts and is single use (spent in the same transaction that claims the releases).
- **The message says what it approves.** The SMS reads "NoLSAF code 123456 to withdraw TZS 180,000 to Vodacom ***456 ... Never share this code."
- **Refused when:** the phone or email changed within the recent-change window (72h); more than 3 codes are requested in 15 minutes; there is no verified contact; there is no verified mobile money account.
- **Burned when:** the payout account changed, or any bound payout went on hold, between sending and confirming. The owner starts again.
- **Undeliverable codes are expired immediately.**
- **Confirming submits the claim** (DRAFT to REQUESTED) to the existing admin flow, marks the release RELEASED (lane MANUAL), writes a FINANCIAL audit row and notifies admins with `owner_payout_claim_submitted`.

### Phase 3: AUTO lane (built 2026-10-07, uncommitted)

| Piece | Where |
|---|---|
| Lane decision (section 6) and starting an automatic payout | `apps/api/src/services/payouts/autoLane.ts` |
| System approval, no admin, `releaseLane = AUTO` | `approveDisbursementAutomatically` in `services/payouts/ledger.ts` |
| AUTO batches: `formAutoBatch` (same re-verify, fingerprint and risk checks, AUTO items only, stricter MEDIUM rule), `authorizeAutoBatch` (kill switch, daily cap re-summed in the same transaction, integrity checks) | `services/payouts/batching.ts` |
| Human batches skip AUTO items; a human cannot authorize an AUTO batch | `services/payouts/batching.ts` |
| `isAutoLaneRisk` (LOW, or MEDIUM with only FIRST_PAYOUT_TO_BENEFICIARY / AFTER_HOURS_APPROVAL) | `services/payouts/riskScoring.ts` |
| Confirm picks a lane per payout; an AUTO payout that cannot start falls back to admins with the reason | `services/payouts/withdrawal.ts` |
| Unclaimed payouts sent after N days without an OTP (D2), to the verified, unchanged account | `withdrawUnclaimed` in `withdrawal.ts` |
| Worker: unclaimed sweep, then authorize waiting AUTO batches, then form and authorize new ones within today's remaining cap | `runAutoLanePass` in `workers/payoutRelease.ts` |
| Legacy no-OTP claim routes refuse stays with a payout lock (409 `USE_WITHDRAW`) while the flag is on; older stays unaffected | `routes/owner.invoices.ts` (`/:id/submit`), `routes/owner.booking.ts` (`/:id/send-invoice`); the owner invoice page redirects to My Payouts |
| Admin settings: on/off switch, daily cap (TZS), unclaimed days (3 to 90). Turning on, raising the cap or shortening the days needs the finance code | `routes/admin.settings.ts`, "Automatic owner payouts" section in `/admin/management/settings` |
| Tests | `autoLane.test.ts`, `autoBatch.test.ts`, updated `withdrawal.test.ts`; full API suite green (1974 passed) |

To go live after the migration: set `PAYOUT_RELEASE_ENABLED=true`; then in admin settings turn on "Send clean payouts automatically", set the daily cap to **2,000,000 TZS** (D5) and unclaimed days to **14** (D2). The existing `DISBURSEMENTS_ENABLED` batch sender does the actual sending.

Open items:
- **Unclaimed reminder (policy 5.2.2): BUILT.** `remindUnclaimed` in `withdrawal.ts` runs in the worker before the unclaimed sender. 48 hours before the deadline it sends an in-app notice (`owner_payout_unclaimed_reminder`) and an SMS to the verified phone: "NoLSAF: TZS X is ready in My Payouts. If you do not withdraw it, we will send it to Vodacom ***456 on {date} EAT." There is no code in the message. Each reminder is recorded once per payout in the audit log (`OWNER_PAYOUT_UNCLAIMED_REMINDER`). `withdrawUnclaimed` **refuses any payout without a reminder at least 48 hours old**, so the promise holds even after worker downtime. No schema change.
- The policy update with 21 days' notice (section 12.1) must be published before the AUTO lane is switched on.
- **Phase 5 (no-show and late cancellation): deliberately left as it is (Daniel, 2026-10-07).** Principle for any future design: a guest is **not** a no-show for missing the check-in day. A guest booked from 7/10 for 20 days who arrives on 10/10 is still inside the stay window and is checked in normally (the unlock rule already handles this: validation on 10/10 unlocks on 11/10). A stay can only count as a no-show once the **checkout date has passed** with no check-in, and even then it should be reconciled politely with the guest rather than charged automatically.

### Owner Payouts workspace (UI rebuilt 2026-10-07, uncommitted)

The previous owner money screens (My Revenue: Requested, Paid Invoices, Rejected, the My Payouts page and the payout block in Profile) are replaced by one **Payouts** workspace at `/owner/payouts`, with the owner dark band header and underline tabs:

| Page | Route | Content |
|---|---|---|
| Overview | `/owner/payouts` | Ready to withdraw (large figure), Withdraw with one-time code, Unlocking / On its way / On hold / Paid this month, recovery owed, next stays. Before the flag is on: a notice that the new flow starts 28 October 2026, with links to Older claims and Payout account |
| In progress | `/owner/payouts/in-progress` | Every active stay with a five-step tracker (Checked in, Unlocks, Ready, Withdrawn, Paid) and filters |
| History | `/owner/payouts/history` | Finished payouts (Paid, Settled against a refund, Cancelled) from both flows; previous-flow rows tagged "Older claim" |
| Payout account | `/owner/payouts/account` | Verify and change the mobile money account (moved from Profile), account status with the 72-hour wait, protection summary. Bank is shown as "not available yet" (`bankPayoutsAvailable={false}`) |
| Older claims | `/owner/payouts/older-claims` | Open claims from the previous invoice flow only (`scope=legacy` excludes claims that have a payout lock), in the old Submitted / Verified / Approved / Disbursed steps |

- One vocabulary: the API computes a single `stage` per payout (`ownerPayoutStage` in `release.ts`: UNLOCKING, WAITING, ON_HOLD, READY, SENDING, UNDER_REVIEW, PAID, SETTLED, CANCELLED); every screen labels it from `components/owner-payouts/shared.ts`.
- Old routes redirect: `/owner/revenue` to Overview, `/requested` to Older claims, `/paid` and `/rejected` to History. Receipt and invoice detail pages are unchanged.
- Sidebar, mobile nav, header menus and the owner dashboard tile now say "Payouts". Profile shows a one-line payout account summary linking to Payouts.
- **Payout receipt in the NRMS folio receipt layout (2026-10-07).** `generateOwnerDisbursementPdf` (`lib/pdfDocuments.ts`) is now an **A5** receipt like the NRMS folio and billing receipts (masthead, teal rule, amount card with PAID mark and the verification QR, Payout information and Stay details rows, and a footer zone with the statement line, Code128 barcode, reference and contact line). The QR is always drawn fresh from the signed verification link. It shows the owner's payout only, never the commission, and its inputs are unchanged, so the payout email attachment and the admin copy use the same look. New `GET /api/owner/revenue/invoices/:id/receipt.pdf` serves it from the sealed receipt snapshot. The owner receipt page (`/owner/revenue/receipts/[id]`) is now a viewer of that PDF with Download and Print.
- Existing gap noticed, not changed: legacy receipt links use the numeric invoice id (`/owner/revenue/receipts/<id>`), against the opaque-reference rule.

### Phase 4: recovery (built 2026-10-07, uncommitted)

Decisions: recover the **owner's share only**, refund x (owner payout / guest paid), capped at what the owner was paid; **deduct from the next payouts**, with the owner's payouts going to an admin while a debt is open and a repay request after 7 business days; **chargebacks are recorded manually by an admin**.

| Piece | Where |
|---|---|
| Migration, prepared, **not applied**: `owner_payout_recovery`, `owner_payout_recovery_application` | `prisma/migrations/20261008090000_add_owner_payout_recovery/migration.sql` |
| Service: share calculation, record (idempotent per refund or chargeback reference), deduct oldest first with conditional updates, overdue repay request, waive | `apps/api/src/services/payouts/recovery.ts` |
| Refund hook: a cancellation reaching REFUNDED records the recovery (net amount paid to the guest) | `routes/admin.cancellations.ts` |
| Payable = netPayable minus deductions; the claim is never rewritten; a fully used claim is refused | `eligibility.loadOwnerInvoice` |
| Withdrawal: the SMS and screen show the amount after deduction; the debt is bound into the code fingerprint; deduction before the lane; a fully used claim settles as lane OFFSET with nothing sent; an open debt sends payouts to an admin | `withdrawal.ts` |
| Worker: repay request (owner and admin notices) once per overdue debt | `requestOverdueRepayments` in the release worker |
| Admin API: `GET /api/admin/disbursements/recoveries`, `POST .../recoveries/chargeback`, `POST .../recoveries/:id/waive` (finance code for both writes) | `routes/admin.disbursements.ts` |
| Admin UI: "Recoveries" tab in the disbursement workspace | `apps/web/app/(admin)/admin/disbursements/recoveries/page.tsx` |
| Owner UI: outstanding amount note, deduction shown in the code step and confirmation | `OwnerPayoutReleasesCard.tsx`; `recoveryDue` on `GET /api/owner/payouts/releases` |
| Tests | `recovery.test.ts`, recovery cases in `withdrawal.test.ts` and `payoutEligibilityAmounts.test.ts`; full API suite green (1994 passed) |

Scope note: a recovery is only created when the owner was **PAID** for the stay. A refund before payment is handled by the payout hold instead. A refund on a payout still in flight (approved but not yet paid) needs an admin to stop or reject that payout; this is not automated.
