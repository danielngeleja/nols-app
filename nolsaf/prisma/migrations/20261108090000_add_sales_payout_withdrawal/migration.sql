-- Sales partner withdrawals with policy checks (prepared 2026-11-08, NOT applied; apply only with Daniel's approval)
--
-- systemsetting           salesAutoPayoutEnabled (off) and salesAutoPayoutMaxTzs (TSh 500,000)
-- sales_partner_profile   payoutHold* (withdrawal freeze after a fraud signal, cleared by an admin)
--                         withdrawalOtp* (three wrong codes lock withdrawals)
-- sales_payout_request    lane (AUTO / REVIEW), reviewFlags, the confirmed payoutAccountId and
--                         challengeId, and AUTO handoff progress
-- sales_payout_challenge  one withdrawal code: hash only, bound to earnings, total and account
--
-- Additive only: new nullable or defaulted columns and one new table. Valid on MySQL 8 (staging)
-- and MariaDB 11.8 (production). Apply BEFORE deploying the API that reads these columns.
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_payout_challenge`;
--   ALTER TABLE `sales_payout_request` DROP INDEX `sales_payout_request_lane_status_idx`,
--     DROP COLUMN `challengeId`, DROP COLUMN `handoffAttempts`, DROP COLUMN `handoffError`,
--     DROP COLUMN `lane`, DROP COLUMN `payoutAccountId`, DROP COLUMN `reviewFlags`;
--   ALTER TABLE `sales_partner_profile` DROP COLUMN `payoutHoldAt`, DROP COLUMN `payoutHoldFlags`,
--     DROP COLUMN `payoutHoldReason`, DROP COLUMN `withdrawalOtpFailures`, DROP COLUMN `withdrawalOtpLockedAt`;
--   ALTER TABLE `systemsetting` DROP COLUMN `salesAutoPayoutEnabled`, DROP COLUMN `salesAutoPayoutMaxTzs`;

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `salesAutoPayoutEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `salesAutoPayoutMaxTzs` INTEGER NOT NULL DEFAULT 500000;

-- AlterTable
ALTER TABLE `sales_partner_profile` ADD COLUMN `payoutHoldAt` DATETIME(3) NULL,
    ADD COLUMN `payoutHoldFlags` JSON NULL,
    ADD COLUMN `payoutHoldReason` VARCHAR(300) NULL,
    ADD COLUMN `withdrawalOtpFailures` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `withdrawalOtpLockedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `sales_payout_request` ADD COLUMN `challengeId` INTEGER NULL,
    ADD COLUMN `handoffAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `handoffError` VARCHAR(500) NULL,
    ADD COLUMN `lane` VARCHAR(10) NULL,
    ADD COLUMN `payoutAccountId` INTEGER NULL,
    ADD COLUMN `reviewFlags` JSON NULL;

-- CreateTable
CREATE TABLE `sales_payout_challenge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `commissionIds` JSON NOT NULL,
    `totalAmount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `payoutAccountId` INTEGER NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `codeHash` VARCHAR(128) NOT NULL,
    `channel` VARCHAR(10) NOT NULL,
    `destinationMasked` VARCHAR(40) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_payout_challenge_reference_key`(`reference`),
    INDEX `sales_payout_challenge_salesPartnerId_createdAt_idx`(`salesPartnerId`, `createdAt`),
    INDEX `sales_payout_challenge_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sales_payout_request_lane_status_idx` ON `sales_payout_request`(`lane`, `status`);

-- AddForeignKey
ALTER TABLE `sales_payout_challenge` ADD CONSTRAINT `sales_payout_challenge_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

