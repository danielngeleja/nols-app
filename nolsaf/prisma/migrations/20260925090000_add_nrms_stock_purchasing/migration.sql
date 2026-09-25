-- NRMS stock control milestone 2 (docs/NRMS_STOCK_AND_PURCHASING.md)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
-- Requires 20260924090000_add_nrms_stock_foundation to have run first.
--
-- Additive only: eight new tables, nothing existing is altered.
--
--   nrms_stock_settings       per-property limits (purchase approval, write-off approval, price alert %) + store switch
--   nrms_supplier             supplier directory (terms, receiving channels, delivery days)
--   nrms_supplier_price       last price paid and agreed price per supplier and good
--   nrms_goods_receipt(_line) goods received notes: scale vs paper quantity, rejections, price flags, photo
--   nrms_stock_transfer(_line) two-step transfers between locations (sent, then confirmed received)
--   nrms_stock_write_off      wastage, staff meals, complimentary, with manager approval above the limit

-- CreateTable
CREATE TABLE `nrms_stock_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `storeEnabled` BOOLEAN NOT NULL DEFAULT false,
    `directPurchaseLimit` DECIMAL(14, 2) NOT NULL DEFAULT 200000.00,
    `writeOffLimit` DECIMAL(14, 2) NOT NULL DEFAULT 20000.00,
    `priceAlertPercent` INTEGER NOT NULL DEFAULT 10,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_stock_settings_propertyId_key`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_supplier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `contactName` VARCHAR(120) NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(160) NULL,
    `tin` VARCHAR(30) NULL,
    `vrn` VARCHAR(30) NULL,
    `location` VARCHAR(200) NULL,
    `paymentTerms` VARCHAR(20) NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    `payChannels` JSON NULL,
    `deliveryDays` VARCHAR(120) NULL,
    `leadTimeDays` INTEGER NULL,
    `notes` VARCHAR(500) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `nrms_supplier_propertyId_status_idx`(`propertyId`, `status`),
    UNIQUE INDEX `nrms_supplier_propertyId_name_key`(`propertyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_supplier_price` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplierId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `lastUnitCost` DECIMAL(14, 4) NULL,
    `agreedUnitCost` DECIMAL(14, 4) NULL,
    `lastReceivedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `nrms_supplier_price_stockItemId_idx`(`stockItemId`),
    UNIQUE INDEX `nrms_supplier_price_supplierId_stockItemId_key`(`supplierId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_goods_receipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `receiptNumber` VARCHAR(40) NOT NULL,
    `supplierId` INTEGER NULL,
    `locationId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    `paymentMode` VARCHAR(20) NOT NULL DEFAULT 'PAID',
    `paymentMethod` VARCHAR(30) NULL,
    `paymentReference` VARCHAR(80) NULL,
    `supplierDocumentNumber` VARCHAR(80) NULL,
    `photoUrl` VARCHAR(500) NULL,
    `note` VARCHAR(300) NULL,
    `totalCost` DECIMAL(14, 2) NOT NULL,
    `rejectedValue` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `flaggedLines` INTEGER NOT NULL DEFAULT 0,
    `receivedById` INTEGER NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `voidedById` INTEGER NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_goods_receipt_receiptNumber_key`(`receiptNumber`),
    INDEX `nrms_goods_receipt_propertyId_status_receivedAt_idx`(`propertyId`, `status`, `receivedAt`),
    INDEX `nrms_goods_receipt_supplierId_receivedAt_idx`(`supplierId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_goods_receipt_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `packUnitName` VARCHAR(40) NULL,
    `packCount` DECIMAL(14, 3) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `claimedQuantity` DECIMAL(14, 3) NULL,
    `rejectedQuantity` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `rejectReason` VARCHAR(30) NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL,
    `lineTotal` DECIMAL(14, 2) NOT NULL,
    `previousUnitCost` DECIMAL(14, 4) NULL,
    `priceFlag` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `expiresAt` DATE NULL,
    `movementId` INTEGER NULL,

    INDEX `nrms_goods_receipt_line_receiptId_idx`(`receiptId`),
    INDEX `nrms_goods_receipt_line_stockItemId_idx`(`stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_transfer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `transferNumber` VARCHAR(40) NOT NULL,
    `fromLocationId` INTEGER NOT NULL,
    `toLocationId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'IN_TRANSIT',
    `note` VARCHAR(300) NULL,
    `sentById` INTEGER NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `receivedById` INTEGER NULL,
    `receivedAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_stock_transfer_transferNumber_key`(`transferNumber`),
    INDEX `nrms_stock_transfer_propertyId_status_sentAt_idx`(`propertyId`, `status`, `sentAt`),
    INDEX `nrms_stock_transfer_toLocationId_status_idx`(`toLocationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_transfer_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transferId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `quantitySent` DECIMAL(14, 3) NOT NULL,
    `quantityReceived` DECIMAL(14, 3) NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL,

    INDEX `nrms_stock_transfer_line_transferId_idx`(`transferId`),
    INDEX `nrms_stock_transfer_line_stockItemId_idx`(`stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_write_off` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `reasonCode` VARCHAR(20) NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `note` VARCHAR(300) NULL,
    `photoUrl` VARCHAR(500) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `requestedById` INTEGER NULL,
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `movementId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `nrms_stock_write_off_propertyId_status_createdAt_idx`(`propertyId`, `status`, `createdAt`),
    INDEX `nrms_stock_write_off_locationId_stockItemId_idx`(`locationId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nrms_stock_settings` ADD CONSTRAINT `nrms_stock_settings_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier` ADD CONSTRAINT `nrms_supplier_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_price` ADD CONSTRAINT `nrms_supplier_price_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `nrms_supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_price` ADD CONSTRAINT `nrms_supplier_price_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt` ADD CONSTRAINT `nrms_goods_receipt_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt` ADD CONSTRAINT `nrms_goods_receipt_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `nrms_supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt` ADD CONSTRAINT `nrms_goods_receipt_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt_line` ADD CONSTRAINT `nrms_goods_receipt_line_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `nrms_goods_receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt_line` ADD CONSTRAINT `nrms_goods_receipt_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_transfer` ADD CONSTRAINT `nrms_stock_transfer_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_transfer` ADD CONSTRAINT `nrms_stock_transfer_fromLocationId_fkey` FOREIGN KEY (`fromLocationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_transfer` ADD CONSTRAINT `nrms_stock_transfer_toLocationId_fkey` FOREIGN KEY (`toLocationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_transfer_line` ADD CONSTRAINT `nrms_stock_transfer_line_transferId_fkey` FOREIGN KEY (`transferId`) REFERENCES `nrms_stock_transfer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_transfer_line` ADD CONSTRAINT `nrms_stock_transfer_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_write_off` ADD CONSTRAINT `nrms_stock_write_off_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_write_off` ADD CONSTRAINT `nrms_stock_write_off_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_write_off` ADD CONSTRAINT `nrms_stock_write_off_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
