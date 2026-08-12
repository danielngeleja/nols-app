-- Verified-stay review: per-category scores, platform intent and the recovery queue.
--
-- Additive only. Every column is nullable or has a default, so existing rows and
-- the currently deployed API keep working unchanged if this runs before the deploy.
-- Safe to run on a live database: no rewrites of existing data, no dropped columns.

-- Which categories a property asks departing guests about (owner-chosen).
-- NULL means "use the default set" and is the state every existing property starts in.
ALTER TABLE `property`
  ADD COLUMN `nrmsReviewCategories` JSON NULL;

-- Guest response detail.
ALTER TABLE `nrms_review_request`
  ADD COLUMN `categoryRatings` JSON NULL,
  ADD COLUMN `platformIntent` VARCHAR(10) NULL,
  ADD COLUMN `needsRecovery` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `recoveredAt` DATETIME(3) NULL,
  ADD COLUMN `recoveryNote` VARCHAR(500) NULL;

-- Owner recovery queue: open low-rating responses for one property.
CREATE INDEX `nrms_review_request_propertyId_needsRecovery_recoveredAt_idx`
  ON `nrms_review_request` (`propertyId`, `needsRecovery`, `recoveredAt`);

-- Backfill: flag already-submitted low ratings so the recovery queue is not empty
-- on day one. Only touches rows that have actually been answered.
UPDATE `nrms_review_request`
  SET `needsRecovery` = 1
  WHERE `respondedAt` IS NOT NULL AND `rating` IS NOT NULL AND `rating` <= 3;
