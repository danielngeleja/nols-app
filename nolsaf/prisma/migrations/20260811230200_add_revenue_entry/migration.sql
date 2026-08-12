-- The revenue book of record.
--
-- Today /admin/finance recomputes revenue on every page load by scanning
-- mutable source rows (invoice.status='PAID', tour_bookings.paymentStatus='PAID',
-- group_booking.depositPaid, nrms_service_payment.status). That is a report, not
-- books. Consequences:
--   * Editing a commission percent silently restates closed periods.
--   * Moving a row out of PAID erases revenue that was genuinely earned.
--   * There is no record of WHEN something was recognized, only that it is
--     currently in a paid state.
--   * A period's number cannot be reproduced after the fact.
--
-- This table records recognition as an event instead of deriving it. It is
-- append-only: a correction is a new REVERSAL row pointing at the original,
-- never an UPDATE. That is the same discipline disbursement_event already
-- applies on the payout side, which is the half of the system that is currently
-- auditable.
--
-- Rollout is non-breaking. Nothing reads this table on day one. The settlement
-- paths start writing to it, financeOverview is repointed once a backfill has
-- been reconciled against the current aggregator output, and the aggregator
-- stays available as a cross-check.

CREATE TABLE `revenue_entry` (
  `id` INT NOT NULL AUTO_INCREMENT,

  -- ACCOMMODATION | TOUR | TRANSPORT | GROUP_STAY | SUBSCRIPTION
  `stream` VARCHAR(20) NOT NULL,

  -- What produced this entry. sourceKey is "<stream>:<sourceType>:<sourceId>"
  -- and is UNIQUE: it is what makes recognition idempotent, so a webhook retry
  -- or a backfill re-run can never double-count revenue. Same guard as
  -- nrms_ledger_transaction.sourceKey and disbursement.activeSourceKey.
  `sourceType` VARCHAR(30) NOT NULL,
  `sourceId`   INT NOT NULL,
  `sourceKey`  VARCHAR(120) NOT NULL,

  -- Business meaning of the money, all in the transaction's own currency.
  --   gross       = what the customer paid (GMV)
  --   commission  = NoLSAF's own take
  --   partnerNet  = what the owner/operator/driver is owed (gross - commission)
  -- Subscriptions carry commission = gross and partnerNet = 0: there is no split.
  `currency`   VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `gross`      DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  `commission` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  `partnerNet` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,

  -- Frozen conversion to the money of record, so a later FX edit cannot restate
  -- a closed period. For TZS rows fxTzsPerUnit is 1 and grossTzs = gross.
  `fxTzsPerUnit`  DECIMAL(18, 6) NOT NULL DEFAULT 1.000000,
  `grossTzs`      DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  `commissionTzs` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  `partnerNetTzs` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,

  -- RECOGNIZED | REVERSAL. Never updated in place.
  `entryType` VARCHAR(20) NOT NULL DEFAULT 'RECOGNIZED',
  -- Set on a REVERSAL row, pointing at the entry it cancels. A reversal carries
  -- the negated amounts, so SUM() over the table is always the true position.
  `reversesId` INT NULL,
  `reason`     VARCHAR(300) NULL,

  -- When the money was recognized, and the business day it belongs to. Separate
  -- because a callback that lands after midnight still belongs to the prior day.
  `recognizedAt` DATETIME(3) NOT NULL,
  `businessDate` DATE NOT NULL,

  -- Provenance: the verified provider callback this recognition came from.
  `paymentEventId` INT NULL,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `revenue_entry_sourceKey_key` (`sourceKey`),
  KEY `revenue_entry_stream_businessDate_idx` (`stream`, `businessDate`),
  KEY `revenue_entry_businessDate_idx` (`businessDate`),
  KEY `revenue_entry_recognizedAt_idx` (`recognizedAt`),
  KEY `revenue_entry_paymentEventId_idx` (`paymentEventId`),
  KEY `revenue_entry_reversesId_idx` (`reversesId`),

  CONSTRAINT `revenue_entry_reversesId_fkey`
    FOREIGN KEY (`reversesId`) REFERENCES `revenue_entry` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: losing the provider event must never delete the
  -- record that revenue was earned.
  CONSTRAINT `revenue_entry_paymentEventId_fkey`
    FOREIGN KEY (`paymentEventId`) REFERENCES `payment_events` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No backfill here on purpose. Backfilling revenue is a reconciliation exercise,
-- not a DDL step: every historical row has to be replayed with the commission
-- percent that applied AT THE TIME, and the result reconciled against what
-- /admin/finance currently reports before anything is trusted. That belongs in a
-- reviewed script with a dry-run mode, run once, with the diff inspected.
