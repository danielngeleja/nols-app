-- NRMS stock control milestone 4: requisitions and purchase orders (docs/NRMS_STOCK_AND_PURCHASING.md)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
-- Requires 20260926090000_add_nrms_stock_counts to have run first.
--
-- Additive only: four new tables, two columns on nrms_stock_settings (with
-- defaults) and two nullable link columns on the goods received note tables.
--
--   nrms_stock_requisition(_line)   a shelf asking for goods, no supplier or price
--   nrms_purchase_order(_line)      what is ordered from one supplier, at what price
--   nrms_goods_receipt.purchaseOrderId, nrms_goods_receipt_line.purchaseOrderLineId
--                                   a delivery received against an order
--   nrms_stock_settings.purchaseOrderLimit    manager order above this waits for the owner
--   nrms_stock_settings.overDeliveryPercent   delivery allowance above the ordered quantity

-- AlterTable
ALTER TABLE `nrms_stock_settings` ADD COLUMN `overDeliveryPercent` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `purchaseOrderLimit` DECIMAL(14, 2) NOT NULL DEFAULT 500000.00;

-- AlterTable
ALTER TABLE `nrms_goods_receipt` ADD COLUMN `purchaseOrderId` INTEGER NULL;

-- AlterTable
ALTER TABLE `nrms_goods_receipt_line` ADD COLUMN `purchaseOrderLineId` INTEGER NULL;

-- CreateTable
CREATE TABLE `nrms_stock_requisition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `requisitionNumber` VARCHAR(40) NOT NULL,
    `locationId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `neededBy` DATE NULL,
    `note` VARCHAR(300) NULL,
    `requestedById` INTEGER NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedById` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `closeNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nrms_stock_requisition_requisitionNumber_key`(`requisitionNumber`),
    INDEX `nrms_stock_requisition_propertyId_status_requestedAt_idx`(`propertyId`, `status`, `requestedAt`),
    INDEX `nrms_stock_requisition_locationId_status_idx`(`locationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_stock_requisition_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requisitionId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `packUnitName` VARCHAR(40) NULL,
    `packCount` DECIMAL(14, 3) NULL,
    `purchaseOrderId` INTEGER NULL,

    INDEX `nrms_stock_requisition_line_requisitionId_idx`(`requisitionId`),
    INDEX `nrms_stock_requisition_line_stockItemId_idx`(`stockItemId`),
    INDEX `nrms_stock_requisition_line_purchaseOrderId_idx`(`purchaseOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_purchase_order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `orderNumber` VARCHAR(40) NOT NULL,
    `supplierId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `expectedDate` DATE NULL,
    `note` VARCHAR(500) NULL,
    `totalCost` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `createdById` INTEGER NULL,
    `submittedById` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvalNote` VARCHAR(300) NULL,
    `sentVia` VARCHAR(20) NULL,
    `sentById` INTEGER NULL,
    `sentAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `closedById` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `closeReason` VARCHAR(300) NULL,
    `supplierToken` VARCHAR(96) NULL,
    `supplierViewedAt` DATETIME(3) NULL,
    `supplierConfirmedAt` DATETIME(3) NULL,
    `supplierDeliveryDate` DATE NULL,
    `supplierNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nrms_purchase_order_orderNumber_key`(`orderNumber`),
    UNIQUE INDEX `nrms_purchase_order_supplierToken_key`(`supplierToken`),
    INDEX `nrms_purchase_order_propertyId_status_createdAt_idx`(`propertyId`, `status`, `createdAt`),
    INDEX `nrms_purchase_order_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `nrms_purchase_order_locationId_status_idx`(`locationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_purchase_order_line` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `stockItemId` INTEGER NOT NULL,
    `packUnitName` VARCHAR(40) NULL,
    `packCount` DECIMAL(14, 3) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `unitCost` DECIMAL(14, 4) NOT NULL,
    `lineTotal` DECIMAL(14, 2) NOT NULL,
    `receivedQuantity` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,

    INDEX `nrms_purchase_order_line_stockItemId_idx`(`stockItemId`),
    UNIQUE INDEX `nrms_purchase_order_line_orderId_stockItemId_key`(`orderId`, `stockItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `nrms_goods_receipt_purchaseOrderId_idx` ON `nrms_goods_receipt`(`purchaseOrderId`);

-- CreateIndex
CREATE INDEX `nrms_goods_receipt_line_purchaseOrderLineId_idx` ON `nrms_goods_receipt_line`(`purchaseOrderLineId`);

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt` ADD CONSTRAINT `nrms_goods_receipt_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `nrms_purchase_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt_line` ADD CONSTRAINT `nrms_goods_receipt_line_purchaseOrderLineId_fkey` FOREIGN KEY (`purchaseOrderLineId`) REFERENCES `nrms_purchase_order_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_requisition` ADD CONSTRAINT `nrms_stock_requisition_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_requisition` ADD CONSTRAINT `nrms_stock_requisition_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_requisition_line` ADD CONSTRAINT `nrms_stock_requisition_line_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `nrms_stock_requisition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_requisition_line` ADD CONSTRAINT `nrms_stock_requisition_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_stock_requisition_line` ADD CONSTRAINT `nrms_stock_requisition_line_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `nrms_purchase_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_purchase_order` ADD CONSTRAINT `nrms_purchase_order_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_purchase_order` ADD CONSTRAINT `nrms_purchase_order_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `nrms_supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_purchase_order` ADD CONSTRAINT `nrms_purchase_order_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `nrms_stock_location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_purchase_order_line` ADD CONSTRAINT `nrms_purchase_order_line_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `nrms_purchase_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_purchase_order_line` ADD CONSTRAINT `nrms_purchase_order_line_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `nrms_stock_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

