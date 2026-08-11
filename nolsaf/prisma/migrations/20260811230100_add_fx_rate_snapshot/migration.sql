-- Freeze the FX rate used at transaction time on the multi-currency streams.
--
-- TZS is the money of record and every charge settles in TZS, so this is not a
-- settlement bug. It is a reporting one: admin.financeOverview normalizes the
-- non-TZS streams to TZS with getFxRates(), which returns rates as they are
-- TODAY. Editing a rate in admin settings therefore changes what last quarter
-- earned. A closed period must not move.
--
-- Additive and nullable. Rows written before this lands stay NULL and the
-- reporting layer keeps falling back to live rates for them, so nothing breaks
-- and nothing is retroactively restated. Only new rows become reproducible.
--
-- Stored in the same shape as lib/fx.ts: tzsPerUnit, i.e. how many TZS equal
-- one unit of the record's currency. Display value = amountTZS / tzsPerUnit.
-- Decimal(18,6) because thinly-traded pairs need the precision and this is an
-- exchange rate, never an amount.

ALTER TABLE `tour_bookings`
  ADD COLUMN `fxTzsPerUnit` DECIMAL(18, 6) NULL
    COMMENT 'TZS per 1 unit of currency at booking time. NULL = pre-migration, report with live rate.',
  ADD COLUMN `fxCapturedAt` DATETIME(3) NULL
    COMMENT 'When fxTzsPerUnit was captured.';

ALTER TABLE `nrms_service_payment`
  ADD COLUMN `fxTzsPerUnit` DECIMAL(18, 6) NULL
    COMMENT 'TZS per 1 unit of currency at verification time. NULL = pre-migration, report with live rate.',
  ADD COLUMN `fxCapturedAt` DATETIME(3) NULL
    COMMENT 'When fxTzsPerUnit was captured.';

-- Backfill only the unambiguous case: records already denominated in TZS have
-- a rate of exactly 1 by definition, no assumption involved. Every genuinely
-- foreign-currency historical row is deliberately left NULL rather than
-- back-dated with today's rate, which would fabricate history.
UPDATE `tour_bookings`
  SET `fxTzsPerUnit` = 1.000000, `fxCapturedAt` = `createdAt`
  WHERE `currency` = 'TZS' AND `fxTzsPerUnit` IS NULL;

UPDATE `nrms_service_payment`
  SET `fxTzsPerUnit` = 1.000000, `fxCapturedAt` = `createdAt`
  WHERE `currency` = 'TZS' AND `fxTzsPerUnit` IS NULL;
