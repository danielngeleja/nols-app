-- Pricing control, phase 1: room price history (prepared 2026-11-15, NOT applied; apply only with Daniel's approval)
--
-- property_price_change  one row per owner room price change: before, after, change %, reason,
--                        and whether a guardrail flagged it for admin price watch.
--
-- One new table, no foreign keys, nothing else touched. Valid on MySQL 8 (staging) and
-- MariaDB 11.8 (production). The API tolerates the table being absent: price editing keeps
-- working with guardrails, only history and the discount cooldown are skipped.
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `property_price_change`;

-- CreateTable
CREATE TABLE `property_price_change` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `roomKey` VARCHAR(120) NOT NULL,
    `roomType` VARCHAR(160) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `priceBefore` DECIMAL(14, 2) NULL,
    `priceAfter` DECIMAL(14, 2) NOT NULL,
    `discountBefore` DECIMAL(5, 2) NULL,
    `discountAfter` DECIMAL(5, 2) NULL,
    `changePercent` DECIMAL(9, 2) NULL,
    `reason` VARCHAR(300) NULL,
    `flagged` BOOLEAN NOT NULL DEFAULT false,
    `flagReason` VARCHAR(200) NULL,
    `changedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `property_price_change_propertyId_createdAt_idx`(`propertyId`, `createdAt`),
    INDEX `property_price_change_propertyId_roomKey_createdAt_idx`(`propertyId`, `roomKey`, `createdAt`),
    INDEX `property_price_change_flagged_createdAt_idx`(`flagged`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
