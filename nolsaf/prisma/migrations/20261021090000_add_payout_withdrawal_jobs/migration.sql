CREATE TABLE `payout_withdrawal_job` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `releaseId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `invoiceId` INTEGER NOT NULL,
  `bookingId` INTEGER NOT NULL,
  `challengeId` INTEGER NULL,
  `payoutAccountId` INTEGER NOT NULL,
  `accountFingerprint` VARCHAR(64) NOT NULL,
  `grossAmount` DECIMAL(14, 2) NOT NULL,
  `plannedDeduction` DECIMAL(14, 2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseUntil` DATETIME(3) NULL,
  `lastError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `payout_withdrawal_job_releaseId_id_idx`(`releaseId`, `id`),
  INDEX `payout_withdrawal_job_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
  INDEX `payout_withdrawal_job_ownerId_status_idx`(`ownerId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payout_withdrawal_job` ADD CONSTRAINT `payout_withdrawal_job_releaseId_fkey` FOREIGN KEY (`releaseId`) REFERENCES `payout_release`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
