# Revenue ledger (`revenue_entry`)

Status, 2026-11-09: the writer is wired into every recognition and reversal
point below. The backfill script is ready and has **not** been run anywhere.
Nothing reads the table yet; `/admin/finance` still recomputes from source rows.

`revenue_entry` (migration `20260811230200_add_revenue_entry`) is the record of
money NoLSAF has earned. It is append only: revenue is a `RECOGNIZED` row, and
a refund or chargeback is a `REVERSAL` row with negated amounts and
`reversesId` pointing at the row it reverses. `SUM()` over the table is always
the true position, and a closed period cannot be restated by a later edit to a
commission percent, an FX rate or a source status.

Code:

| File | What it does |
| --- | --- |
| `apps/api/src/lib/revenueLedger.ts` | `recognizeRevenue()`, `reverseRevenue()`: idempotency, EAT business date, frozen FX, never updates a row |
| `apps/api/src/lib/revenueRecognition.ts` | One function per recognition and reversal point; reads the source row, applies the amount rule |
| `apps/api/scripts/backfill-revenue-entries.ts` | Dry-run-by-default backfill through the same functions |

## Rules the writer enforces

* **Idempotent on `sourceKey`** = `<stream>:<sourceType>:<sourceId>` (UNIQUE).
  A webhook retry, the Coral callback plus browser postback pair, the
  reconciliation worker and a backfill re-run all find the row and write
  nothing. The first recognition is the record: a replay with different
  amounts returns the original row unchanged.
* **Atomic with the status change.** Every live call runs inside the
  transaction that flips the source to paid or refunded, after the conditional
  claim (`updateMany ... where status not PAID`) succeeds. Only the claim winner
  records, and a failed ledger write rolls the claim back.
* **Frozen money.** `fxTzsPerUnit` and the `*Tzs` amounts are fixed at write
  time. Tours use the rate frozen on the booking (`TourBooking.fxTzsPerUnit`)
  and fall back to the current rate in `lib/fx` when the booking has none. A
  currency with no rate throws rather than booking 1:1. A reversal reuses the
  rate of the row it reverses, so a full refund nets to exactly zero in TZS.
* **`businessDate` is the Africa/Dar_es_Salaam calendar day** (UTC+3, no DST)
  of the recognition instant: 21:00 UTC is midnight. `recognizedAt` keeps the
  exact instant.
* **`paymentEventId`** links the provider callback: the latest `SUCCESS`
  `PaymentEvent` for the invoice, tour or group booking; for NRMS the event whose
  `eventId` equals the payment's `providerRef`. Admin manual payments have none.
* **Reversals are proportional and capped.** A refund of `R` out of an original
  gross `G` takes `R/G` of the commission and of the partner net (owner policy
  6.3.2.2: NoLSAF gives back its own share). Later reversals are capped at what
  is left, under a `SELECT ... FOR UPDATE` lock on the original row (valid on
  MySQL 8 and MariaDB 11.8). A reversal whose original was never recognized is
  skipped and reported, never thrown.

## Recognition points (money in)

Amount rules deliberately mirror `lib/financeOverview.ts`, so the ledger can be
reconciled against today's figures before cutover.

| Stream | Where it becomes final | sourceKey | gross / commission / partnerNet | recognizedAt |
| --- | --- | --- | --- | --- |
| ACCOMMODATION | `markInvoicePaid` (`routes/webhooks.payments.ts`): AzamPay webhook, Coral card callback and postback, `reconcileUnsettledPayments` worker, booking payment cases | `ACCOMMODATION:INVOICE:<invoiceId>` | `total` / `commissionAmount` / `netPayable` | `invoice.paidAt` |
| ACCOMMODATION | `admin.invoices.ts` `POST /:id/mark-paid` | same | same | same |
| ACCOMMODATION | `admin.revenue.ts` `POST /invoices/:id/mark-paid` | same | same | same |
| TOUR | `markTourBookingPaid` (`webhooks.payments.ts`): AzamPay, Coral, reconcile worker | `TOUR:TOUR_BOOKING:<id>` | `grossAmount` / `commissionAmount` / gross minus commission, booking currency | `paidAt` |
| GROUP_STAY | `markGroupBookingDepositPaid` (`webhooks.payments.ts`): AzamPay, Coral, reconcile worker | `GROUP_STAY:GROUP_BOOKING:<id>` | `totalAmount` / total minus `ownerAmount` / `ownerAmount` | `depositPaidAt` |
| TRANSPORT | Driver payout claim (`driver.scheduled.ts` `POST /:id/payout-claim`) and admin approval (`admin.drivers.ts` `POST /trips/:id/payout/approve`), when the trip is `paymentStatus = PAID` | `TRANSPORT:TRANSPORT_BOOKING:<id>` | payout `grossAmount` / `commissionAmount` / `netPaid` | payout `createdAt` |
| SUBSCRIPTION | `reconcileNrmsPayment` (`lib/nrmsBilling.ts`): AzamPay, Coral, NRMS callback | `SUBSCRIPTION:NRMS_SERVICE_PAYMENT:<id>` | `amount` / `amount` / 0 | `verifiedAt` |
| SUBSCRIPTION | Admin manual reconcile (`admin.nrms.reconcile.ts` `POST /tokens/:tokenId/reconcile`) | same | same | same |

Notes:

* Owner claims (`OINV-` invoices) are payouts, never revenue. A booking invoice
  whose guest had already paid (status moving through the owner's claim) is not
  recognized again when an admin marks it PAID.
* Transport fares are paid inside the accommodation invoice (`BOOKING:<id>`
  transport rows). The driver commission is only fixed when the payout row is
  created, so that is the transport recognition point.

## Reversal points (money out)

| Stream | Where it happens | sourceKey | Amount reversed |
| --- | --- | --- | --- |
| ACCOMMODATION | Cancellation request moves to `REFUNDED` (`admin.cancellations.ts` `PATCH /:id`, inside its transaction) | `ACCOMMODATION:CANCELLATION_REFUND:<cancellationRequestId>` | net refund paid (`refundChargesJson.netRefundAmount`, else `refundAmount`) |
| ACCOMMODATION | Card chargeback recorded (`POST /admin/disbursements/recoveries/chargeback`) | `ACCOMMODATION:CHARGEBACK:<ownerPayoutRecoveryId>` | chargeback amount |
| TOUR | Tour case action `RECORD_REFUND` (`admin.tourCases.ts` `POST /:id/action`, inside its transaction) | `TOUR:TOUR_REFUND:<tourFinancialTransactionId>` | net refund after channel charges (`metadata.channelCharges.netRefundAmount`, else `amount`) |

A reversal finds its original by the booking's guest invoice (accommodation) or
the tour booking. When the ledger has not seen the original yet (before the
backfill), it recognizes it first, dated at the original `paidAt`, then
reverses.

### Searched and deliberately not recorded

* `PAYOUT_RECOVERY` (tour) and `OwnerPayoutRecovery` collection: the operator
  or owner repaying NoLSAF is a payout-side debt, not customer revenue. The
  refund that caused it is what reverses revenue.
* Owner payouts (`services/payouts/ledger.ts`, `disbursement_event`): payout side.
* `CANCELED` paths: unpaid tour auto-cancel, group stays deleted while `PENDING`,
  unpaid group stays closed by `closeUnpaidPastGroupStays`, transport trips
  cancelled before completion. None had recognized revenue.
* NRMS hotel money (`webhooks.ownerPayments.ts`, guest payment requests, master
  folios, folio refunds): the property's money through its own merchant, not
  NoLSAF's.
* NRMS subscription refunds: no code path exists.
* Group stay deposit refunds: no code path exists.
* `POST /admin/invoices/:id/pay`: retired, returns 410.

## Deploy prerequisite

The settlement paths now write to `revenue_entry` inside the payment
transaction, so the table must exist on the target database before this code
is deployed. Migration `20260811230200_add_revenue_entry` has been in the repo
since 2026-08-12; confirm with `npx prisma migrate status` on each environment
first. If the table were missing, payment confirmation would fail and be
retried by the provider and the reconciliation worker until it exists.

## Backfill

```
cd nolsaf/apps/api
npx tsx scripts/backfill-revenue-entries.ts                       # dry run, writes nothing
npx tsx scripts/backfill-revenue-entries.ts --apply --target=<db host>
```

* Dry run reads the source tables and `revenue_entry`, simulates every write in
  memory, and prints counts and TZS totals per stream, EAT month and entry type,
  the outcome of every source (created, existing, skipped with reason), any
  non-TZS sources that will be booked at today's rate, and all-time ledger
  revenue next to `computeFinanceOverview` per stream.
* `--apply` writes one transaction per source and refuses unless `--target`
  equals the host in `DATABASE_URL`. Re-running is safe.
* It uses the amounts stored on each row when it was paid, not today's
  commission percent. Recognitions run before reversals.
* Not run on any database. Needs Daniel's explicit yes per environment, after
  the code above is deployed (so no live payment lands between the backfill and
  the writer going live without a row; the backfill is idempotent, so running
  it again after deploy also closes that gap).

## Read switch (proposal)

Steps 1 and 2 are built (`lib/revenueReconciliation.ts`, `GET /api/admin/finance/reconciliation`,
`components/admin/RevenueReconciliationPanel.tsx`, the Reconciliation switch on `/admin/finance`).
Steps 3 and 4 are not.

1. **Reconciliation endpoint first.** `GET /api/admin/finance/reconciliation?from=&to=`
   on the finance router (same finance OTP grant). Per stream it returns ledger
   sums (`SUM(*Tzs)` grouped by `stream` over `businessDate`), the current
   `computeFinanceOverview` realized figures for the same EAT days, the delta,
   and the sources behind the delta: paid sources with no ledger row, ledger rows
   whose source no longer qualifies, and amount mismatches.
2. **Reconciliation view.** A tab on `/admin/finance` showing that table, in the
   existing admin card style, with the drill-down list.
3. **Flagged cutover.** `FINANCE_OVERVIEW_SOURCE=recompute|ledger` (default
   `recompute`). With `ledger`, `computeFinanceOverview` takes realized GMV,
   revenue, partner net and counts from `revenue_entry`; pending figures and
   margin stay on the source tables (the ledger holds only realized money). The
   series endpoint becomes one grouped query by `businessDate` instead of up to
   40 recomputations. The unified revenue overview and the payroll coverage view
   share `computeFinanceOverview`, so they switch together. The recompute path
   stays as the cross-check.
4. **Cutover criteria.** Backfill applied; every stream's delta explained for
   the last six months; one week of live writes with no paid source missing a
   row. A daily check for paid sources without a ledger row is a natural
   follow-up to keep that true.

### Figures expected to change at cutover

* **Accommodation goes down by refunds and chargebacks.** The overview keeps a
  refunded booking's full commission because the invoice stays PAID; the ledger
  removes the refunded share.
* **Tours go up for partly refunded bookings.** The overview drops a refunded
  tour entirely (`paymentStatus` leaves PAID); the ledger keeps what was not
  refunded, including retained channel charges.
* **Non-TZS tours and subscriptions move slightly.** The overview converts at
  today's rate on every load; the ledger uses the rate frozen at payment.
* **Day and month edges move.** The overview filters instants as given; the
  ledger buckets by EAT `businessDate`, so payments within three hours of UTC
  midnight can change day. Transport moves most: the overview dates it by the
  trip's `updatedAt`, the ledger by payout creation.
* **Commission edits stop restating history.** A transport payout re-approved
  at a new percent, or an invoice commission edited after payment, changes the
  overview but not the ledger.
* **Unchanged:** subscriptions in TZS, group stays in TZS, pending figures.

## Open decisions for Daniel

1. **Tour refund split.** Implemented: proportional (NoLSAF gives back its
   share). The tour recovery rule makes the operator carry the refund first; if
   NoLSAF should keep its full commission on traveller-caused tour refunds, the
   reversal should take only partner net.
2. **Refund channel charges.** The card surcharge and TZS 25,000 admin charge
   stay inside the booking's original split. They could instead be recognized
   as separate NoLSAF revenue (`gross 0, commission = charges`).
3. **Group stay.** Mirrors the overview: recognizes `totalAmount - ownerAmount`
   at deposit, although NoLSAF only collects the deposit and the owner collects
   the balance at the property.
4. **Chargeback before the owner is paid.** The chargeback route refuses with
   409 when the owner has not been paid (the payout hold applies), so no
   reversal is written for those chargebacks.
5. **Bundled transport GMV.** The invoice `total` includes `transportFare`, and
   the transport stream counts the payout gross again. Both views double count
   that GMV (commission is not affected).
6. **Failure policy.** The ledger write is atomic with the payment claim, as
   asked. The alternative is a best-effort write after commit plus the daily
   gap check, which never blocks a payment but can briefly miss a row.
