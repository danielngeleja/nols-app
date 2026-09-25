-- NRMS stock control milestone 3: counts and variance (docs/NRMS_STOCK_AND_PURCHASING.md)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
-- Requires 20260925090000_add_nrms_stock_purchasing to have run first.
--
-- Additive only: two new tables and two nullable JSON columns on nrms_stock_settings.
--
--   nrms_stock_count        one count session at one location (blind by default)
--   nrms_stock_count_line   counted vs expected per good, frozen at submission
--   nrms_stock_settings.varianceTolerances   per-category tolerance overrides
--   nrms_stock_settings.handoverCountItems   the bar handover count list per location

-- AlterTable
ALTER TABLE `nrms_stock_settings` ADD COLUMN `varianceTolerances` JSON NULL,
    ADD COLUMN `handoverCountItems` JSON NULL;

-- CreateTable
CREATE TABLE `nrms_stock_count` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `countNumber` VARCHAR(40) NOT NULL,
    `scope` VARCHAR(12) NOT NULL DEFAULT 'FULL',
    `blind` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    `note` VARCHAR(300) NULL,
    `startedById` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submittedById` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `cancelledById` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `varianceCost` DECIMAL(14, 2) NULL,
    `varianceSales` DECIMAL(14, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_stock_count_countNumber_key`(`countNumber`),
    INDEX `nrms_stock_count_propertyId_status_startedAt_idx`(`propertyId`, `status`, `startedAt`),
    INDEX `nrms_stock_count_locationId_status_approvedAt_idx`(`locationId`, `status`, `approvedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_count_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `countId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `countedQuantity` DECIMAL(14, 3) NULL,
    `countedAt` DATETIME(3) NULL,
    `countedById` INTEGER NULL,
    `expectedQuantity` DECIMAL(14, 3) NULL,
    `varianceQuantity` DECIMAL(14, 3) NULL,
    `unitCost` DECIMAL(14, 4) NULL,
    `varianceCost` DECIMAL(14, 2) NULL,
    `unitSellPrice` DECIMAL(14, 4) NULL,
    `varianceSales` DECIMAL(14, 2) NULL,
    `recountRequested` BOOLEAN NOT NULL DEFAULT false,
    `note` VARCHAR(300) NULL,
    `movementId` INTEGER NULL,

    INDEX `nrms_stock_count_line_stockItemId_idx`(`stockItemId`),
    UNIQUE INDEX `nrms_stock_count_line_countId_stockItemId_key`(`countId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nrms_stock_count` ADD CONSTRAINT `nrms_stock_count_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_count` ADD CONSTRAINT `nrms_stock_count_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_count_line` ADD CONSTRAINT `nrms_stock_count_line_countId_fkey` FOREIGN KEY (`countId`) REFERENCES `nrms_stock_count`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_count_line` ADD CONSTRAINT `nrms_stock_count_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
