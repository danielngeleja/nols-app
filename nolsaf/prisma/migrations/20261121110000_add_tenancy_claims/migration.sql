-- Long-stay rentals, milestone 8 (docs/LONG_STAY_RENTALS.md section 6.6).
--
-- Claims a landlord owes a tenant under the lease after move-in (unused
-- prepaid months, a balance to return), and the part of a later long-stay
-- payout kept back to recover them.
--
-- Follows 20261121100000_add_long_stay_rentals. Additive only. MySQL 8 and MariaDB 11.8.
-- Prepared 2026-11-21. Not applied anywhere until Daniel approves.
-- AlterTable
ALTER TABLE `tenancy` ADD COLUMN `payoutDeduction` DECIMAL(12, 2) NULL;

-- CreateTable
CREATE TABLE `tenancy_claim` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenancyId` INTEGER NOT NULL,
    `landlordId` INTEGER NOT NULL,
    `tenantId` INTEGER NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `dueAt` DATETIME(3) NOT NULL,
    `recoveredAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `escalatedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closedNote` VARCHAR(500) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tenancy_claim_tenancyId_idx`(`tenancyId`),
    INDEX `tenancy_claim_landlordId_status_idx`(`landlordId`, `status`),
    INDEX `tenancy_claim_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenancy_claim` ADD CONSTRAINT `tenancy_claim_tenancyId_fkey` FOREIGN KEY (`tenancyId`) REFERENCES `tenancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

