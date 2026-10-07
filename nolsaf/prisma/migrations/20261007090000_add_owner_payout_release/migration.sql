-- Owner payout withdrawal, Phase 1 (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md).
-- Prepared 2026-10-07. Apply only with Daniel's approval, after
-- 20261001090000 (payout safeguards). Plain DDL that runs on both MySQL 8
-- (staging) and MariaDB 11.8 (prod). Additive only: new tables, nullable
-- or defaulted columns. The AUTO lane stays off (autoPayoutEnabled = false).

ALTER TABLE `systemsetting`
  ADD COLUMN `autoPayoutEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `autoPayoutDailyCapTzs` INTEGER NULL,
  ADD COLUMN `payoutUnclaimedAutoDays` INTEGER NULL;

ALTER TABLE `disbursement` ADD COLUMN `releaseLane` VARCHAR(10) NULL;

ALTER TABLE `disbursement_batch` ADD COLUMN `mode` VARCHAR(10) NOT NULL DEFAULT 'MANUAL';

CREATE TABLE `payout_release` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sourceType` VARCHAR(20) NOT NULL DEFAULT 'OWNER_INVOICE',
  `sourceId` INTEGER NOT NULL,
  `bookingId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'LOCKED',
  `rule` VARCHAR(30) NOT NULL,
  `releaseAt` DATETIME(3) NOT NULL,
  `availableAt` DATETIME(3) NULL,
  `holdReason` VARCHAR(300) NULL,
  `heldAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `disbursementId` INTEGER NULL,
  `lane` VARCHAR(10) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `payout_release_sourceType_sourceId_key`(`sourceType`, `sourceId`),
  INDEX `payout_release_status_releaseAt_idx`(`status`, `releaseAt`),
  INDEX `payout_release_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `payout_release_bookingId_idx`(`bookingId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `payout_release_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payout_withdrawal_challenge` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `reference` VARCHAR(40) NOT NULL,
  `userId` INTEGER NOT NULL,
  `releaseIds` JSON NOT NULL,
  `totalAmount` DECIMAL(14, 2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `fingerprint` VARCHAR(64) NOT NULL,
  `codeHash` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(10) NOT NULL,
  `destinationMasked` VARCHAR(40) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `payout_withdrawal_challenge_reference_key`(`reference`),
  INDEX `payout_withdrawal_challenge_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `payout_withdrawal_challenge_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
