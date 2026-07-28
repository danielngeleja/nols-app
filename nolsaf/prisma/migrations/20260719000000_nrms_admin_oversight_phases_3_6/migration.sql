-- Prepared only. Do not apply without Daniel's explicit approval.
-- NRMS Admin Oversight phases 3 to 6: dunning, immutable adjustments,
-- integrity signals, public abuse counters, and closed-account retention.

ALTER TABLE `nrms_usage_charge_policy`
  ADD COLUMN `graceDays` INTEGER NOT NULL DEFAULT 3;

ALTER TABLE `owner_payg_account`
  ADD COLUMN `limitReachedAt` DATETIME(3) NULL,
  ADD COLUMN `reminderNotifiedAt` DATETIME(3) NULL,
  ADD COLUMN `warningNotifiedAt` DATETIME(3) NULL,
  ADD COLUMN `freezeNotifiedAt` DATETIME(3) NULL,
  ADD COLUMN `retentionClosedAt` DATETIME(3) NULL,
  ADD COLUMN `guestDataAnonymizedAt` DATETIME(3) NULL,
  ADD COLUMN `operationalDataMinimizedAt` DATETIME(3) NULL;

ALTER TABLE `nrms_usage_event`
  MODIFY `reservationId` INTEGER NULL,
  MODIFY `allocationId` INTEGER NULL;

CREATE TABLE `nrms_integrity_signal` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `kind` VARCHAR(60) NOT NULL,
  `severity` VARCHAR(20) NOT NULL DEFAULT 'ATTENTION',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `metricValue` DECIMAL(14,4) NULL,
  `baseline` DECIMAL(14,4) NULL,
  `details` JSON NULL,
  `observedFrom` DATETIME(3) NOT NULL,
  `observedTo` DATETIME(3) NOT NULL,
  `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  UNIQUE INDEX `nrms_integrity_signal_propertyId_kind_observedTo_key` (`propertyId`, `kind`, `observedTo`),
  INDEX `nrms_integrity_signal_status_severity_detectedAt_idx` (`status`, `severity`, `detectedAt`),
  INDEX `nrms_integrity_signal_propertyId_detectedAt_idx` (`propertyId`, `detectedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `nrms_integrity_signal_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_public_metric` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `metricDate` DATE NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_public_metric_propertyId_metricDate_kind_key` (`propertyId`, `metricDate`, `kind`),
  INDEX `nrms_public_metric_metricDate_kind_idx` (`metricDate`, `kind`),
  PRIMARY KEY (`id`),
  CONSTRAINT `nrms_public_metric_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
