-- Forward-only repair for staging drift discovered on 2026-08-25.
-- Migration 20260825170000_add_meta_message_reliability is recorded as applied
-- there, but nrms_meta_webhook_job is physically absent. Do not rewrite or
-- resolve historical migration rows; restore the required schema idempotently.

ALTER TABLE `nrms_guest_message`
  ADD COLUMN IF NOT EXISTS `attemptCount` INTEGER NOT NULL DEFAULT 0 AFTER `deliveryStatus`,
  ADD COLUMN IF NOT EXISTS `nextAttemptAt` DATETIME(3) NULL AFTER `attemptCount`,
  ADD COLUMN IF NOT EXISTS `lastAttemptAt` DATETIME(3) NULL AFTER `nextAttemptAt`,
  ADD COLUMN IF NOT EXISTS `errorMessage` VARCHAR(1000) NULL AFTER `lastAttemptAt`;

SET @__nolsaf_has_delivery_retry_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_guest_message'
    AND INDEX_NAME = 'nrms_guest_message_delivery_retry_idx'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_delivery_retry_idx = 0,
  'CREATE INDEX `nrms_guest_message_delivery_retry_idx` ON `nrms_guest_message` (`deliveryStatus`, `nextAttemptAt`, `createdAt`)',
  'SELECT ''skip: nrms guest-message retry index already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

CREATE TABLE IF NOT EXISTS `nrms_meta_webhook_job` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `dedupeKey` VARCHAR(191) NOT NULL,
  `propertyId` INTEGER NULL,
  `provider` VARCHAR(20) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `eventKind` VARCHAR(20) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attemptCount` INTEGER NOT NULL DEFAULT 0,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lockedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_meta_webhook_job_dedupeKey_key`(`dedupeKey`),
  INDEX `nrms_meta_webhook_job_ready_idx`(`status`, `availableAt`, `createdAt`),
  INDEX `nrms_meta_webhook_job_completed_idx`(`status`, `completedAt`),
  INDEX `nrms_meta_webhook_job_property_status_idx`(`propertyId`, `status`, `createdAt`),
  INDEX `nrms_meta_webhook_job_account_idx`(`provider`, `accountId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
