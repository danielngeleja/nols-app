-- Make Meta messaging durable: webhook HTTP requests are persisted before
-- acknowledgement and outbound replies remain retryable until provider
-- acceptance or deliberate operational intervention.

ALTER TABLE `nrms_guest_message`
  ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0 AFTER `deliveryStatus`,
  ADD COLUMN `nextAttemptAt` DATETIME(3) NULL AFTER `attemptCount`,
  ADD COLUMN `lastAttemptAt` DATETIME(3) NULL AFTER `nextAttemptAt`,
  ADD COLUMN `errorMessage` VARCHAR(1000) NULL AFTER `lastAttemptAt`;

CREATE INDEX `nrms_guest_message_delivery_retry_idx`
  ON `nrms_guest_message`(`deliveryStatus`, `nextAttemptAt`, `createdAt`);

CREATE TABLE `nrms_meta_webhook_job` (
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
