-- Forward-only repair for staging drift discovered on 2026-08-25.
-- Migration 20260825170000_add_meta_message_reliability is recorded as applied
-- there, but nrms_meta_webhook_job is physically absent. Do not rewrite or
-- resolve historical migration rows; restore the required schema idempotently.

SET @__nolsaf_has_attempt_count := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_guest_message'
    AND COLUMN_NAME = 'attemptCount'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_attempt_count = 0,
  'ALTER TABLE `nrms_guest_message` ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0 AFTER `deliveryStatus`',
  'SELECT ''skip: nrms guest-message attemptCount already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_next_attempt_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_guest_message'
    AND COLUMN_NAME = 'nextAttemptAt'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_next_attempt_at = 0,
  'ALTER TABLE `nrms_guest_message` ADD COLUMN `nextAttemptAt` DATETIME(3) NULL AFTER `attemptCount`',
  'SELECT ''skip: nrms guest-message nextAttemptAt already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_last_attempt_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_guest_message'
    AND COLUMN_NAME = 'lastAttemptAt'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_last_attempt_at = 0,
  'ALTER TABLE `nrms_guest_message` ADD COLUMN `lastAttemptAt` DATETIME(3) NULL AFTER `nextAttemptAt`',
  'SELECT ''skip: nrms guest-message lastAttemptAt already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_error_message := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_guest_message'
    AND COLUMN_NAME = 'errorMessage'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_error_message = 0,
  'ALTER TABLE `nrms_guest_message` ADD COLUMN `errorMessage` VARCHAR(1000) NULL AFTER `lastAttemptAt`',
  'SELECT ''skip: nrms guest-message errorMessage already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

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
