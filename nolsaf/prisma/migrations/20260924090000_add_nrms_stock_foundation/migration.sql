-- NRMS stock foundation (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 1)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
--
-- Additive only: six new tables and one defaulted column on nrms_menu_item.
-- Nothing existing is rewritten. A property that never creates a stock item
-- keeps today's per-menu-item counter exactly as it is.
--
--   nrms_stock_item        physical goods (bottle, can, piece, ml, g) with average cost
--   nrms_stock_pack_unit   purchase packs (crate = 25 bottles)
--   nrms_stock_location    one row per outlet holding stock (STORE kind reserved for m2)
--   nrms_stock_balance     cached per location/item total; only ever changed with a movement
--   nrms_stock_movement    append-only stock ledger
--   nrms_menu_recipe_line  what one menu item consumes
--   nrms_menu_item.stockAutoOut  marks items the system (not a person) switched off

-- AlterTable
ALTER TABLE `nrms_menu_item` ADD COLUMN `stockAutoOut` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `nrms_stock_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `category` VARCHAR(30) NOT NULL,
    `baseUnit` VARCHAR(12) NOT NULL,
    `countStyle` VARCHAR(10) NOT NULL DEFAULT 'WHOLE',
    `perishable` BOOLEAN NOT NULL DEFAULT false,
    `shelfLifeDays` INTEGER NULL,
    `averageCost` DECIMAL(14, 4) NOT NULL DEFAULT 0.0000,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `nrms_stock_item_propertyId_status_category_idx`(`propertyId`, `status`, `category`),
    UNIQUE INDEX `nrms_stock_item_propertyId_name_key`(`propertyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_pack_unit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stockItemId` INTEGER NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `baseQuantity` DECIMAL(14, 3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_stock_pack_unit_stockItemId_name_key`(`stockItemId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `outletId` INTEGER NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_stock_location_outletId_key`(`outletId`),
    INDEX `nrms_stock_location_propertyId_kind_idx`(`propertyId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_balance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locationId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `parLevel` DECIMAL(14, 3) NULL,
    `reorderPoint` DECIMAL(14, 3) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `nrms_stock_balance_stockItemId_idx`(`stockItemId`),
    UNIQUE INDEX `nrms_stock_balance_locationId_stockItemId_key`(`locationId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_movement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL,
    `totalCost` DECIMAL(14, 2) NOT NULL,
    `sourceType` VARCHAR(24) NULL,
    `sourceId` INTEGER NULL,
    `note` VARCHAR(300) NULL,
    `actorId` INTEGER NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `nrms_stock_movement_propertyId_occurredAt_idx`(`propertyId`, `occurredAt`),
    INDEX `nrms_stock_movement_locationId_stockItemId_occurredAt_idx`(`locationId`, `stockItemId`, `occurredAt`),
    INDEX `nrms_stock_movement_stockItemId_type_idx`(`stockItemId`, `type`),
    INDEX `nrms_stock_movement_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_menu_recipe_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menuItemId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `yieldPercent` INTEGER NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `nrms_menu_recipe_line_stockItemId_idx`(`stockItemId`),
    UNIQUE INDEX `nrms_menu_recipe_line_menuItemId_stockItemId_key`(`menuItemId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nrms_stock_item` ADD CONSTRAINT `nrms_stock_item_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_pack_unit` ADD CONSTRAINT `nrms_stock_pack_unit_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_location` ADD CONSTRAINT `nrms_stock_location_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_location` ADD CONSTRAINT `nrms_stock_location_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `nrms_outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_balance` ADD CONSTRAINT `nrms_stock_balance_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_balance` ADD CONSTRAINT `nrms_stock_balance_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_movement` ADD CONSTRAINT `nrms_stock_movement_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_movement` ADD CONSTRAINT `nrms_stock_movement_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_movement` ADD CONSTRAINT `nrms_stock_movement_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_movement` ADD CONSTRAINT `nrms_stock_movement_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_menu_recipe_line` ADD CONSTRAINT `nrms_menu_recipe_line_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `nrms_menu_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_menu_recipe_line` ADD CONSTRAINT `nrms_menu_recipe_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

