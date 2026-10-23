ALTER TABLE `systemsetting`
  ADD COLUMN `ownerWithdrawalDailyLimitTzs` INTEGER NOT NULL DEFAULT 10000000;

ALTER TABLE `payout_withdrawal_challenge`
  ADD COLUMN `planVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `allocationPlan` JSON NULL,
  ADD COLUMN `payoutAccountId` INTEGER NULL,
  ADD COLUMN `accountFingerprint` VARCHAR(64) NULL,
  ADD COLUMN `handoffStatus` VARCHAR(20) NULL,
  ADD COLUMN `handoffAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `handoffLeaseUntil` DATETIME(3) NULL,
  ADD COLUMN `handoffNextAttemptAt` DATETIME(3) NULL;

CREATE TABLE `payout_withdrawal_allocation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `challengeId` INTEGER NOT NULL,
  `releaseId` INTEGER NOT NULL,
  `invoiceId` INTEGER NOT NULL,
  `grossAmount` DECIMAL(14,2) NOT NULL,
  `recoveryDeduction` DECIMAL(14,2) NOT NULL,
  `recoveryTarget` DECIMAL(14,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payout_withdrawal_allocation_challengeId_releaseId_key` (`challengeId`, `releaseId`),
  INDEX `payout_withdrawal_allocation_releaseId_idx` (`releaseId`),
  INDEX `payout_withdrawal_allocation_invoiceId_idx` (`invoiceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `payout_withdrawal_allocation_challengeId_fkey`
    FOREIGN KEY (`challengeId`) REFERENCES `payout_withdrawal_challenge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
