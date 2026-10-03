-- NRMS stock control milestone 5: payables and the ledger (docs/NRMS_STOCK_AND_PURCHASING.md)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
-- Requires 20260927090000_add_nrms_purchase_orders to have run first.
--
-- Additive only: two new tables and two nullable columns.
--
--   nrms_supplier_invoice                 the supplier's bill, checked against accepted deliveries
--   nrms_supplier_payment                 money paid to a supplier (recorded, never moved)
--   nrms_goods_receipt.supplierInvoiceId  the invoice that bills a delivery
--   nrms_stock_movement.ledgerRunId       the Night Audit run that posted the movement;
--                                         null rows are picked up by the next Night Audit

-- AlterTable
ALTER TABLE `nrms_stock_movement` ADD COLUMN `ledgerRunId` INTEGER NULL;

-- AlterTable
ALTER TABLE `nrms_goods_receipt` ADD COLUMN `supplierInvoiceId` INTEGER NULL;

-- CreateTable
CREATE TABLE `nrms_supplier_invoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `supplierId` INTEGER NOT NULL,
    `invoiceNumber` VARCHAR(80) NOT NULL,
    `invoiceDate` DATE NOT NULL,
    `dueDate` DATE NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `vatAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `receivedValue` DECIMAL(14, 2) NOT NULL,
    `matchStatus` VARCHAR(20) NOT NULL DEFAULT 'MATCHED',
    `photoUrl` VARCHAR(500) NULL,
    `note` VARCHAR(300) NULL,
    `recordedById` INTEGER NULL,
    `voidedById` INTEGER NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `nrms_supplier_invoice_propertyId_invoiceDate_idx`(`propertyId`, `invoiceDate`),
    UNIQUE INDEX `nrms_supplier_invoice_supplierId_invoiceNumber_key`(`supplierId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_supplier_payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `supplierId` INTEGER NOT NULL,
    `paymentNumber` VARCHAR(40) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `method` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(80) NULL,
    `paidAt` DATE NOT NULL,
    `invoiceId` INTEGER NULL,
    `note` VARCHAR(300) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `recordedById` INTEGER NULL,
    `voidedById` INTEGER NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `nrms_supplier_payment_paymentNumber_key`(`paymentNumber`),
    INDEX `nrms_supplier_payment_propertyId_createdAt_idx`(`propertyId`, `createdAt`),
    INDEX `nrms_supplier_payment_propertyId_voidedAt_idx`(`propertyId`, `voidedAt`),
    INDEX `nrms_supplier_payment_supplierId_paidAt_idx`(`supplierId`, `paidAt`),
    INDEX `nrms_supplier_payment_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `nrms_stock_movement_propertyId_ledgerRunId_idx` ON `nrms_stock_movement`(`propertyId`, `ledgerRunId`);

-- CreateIndex
CREATE INDEX `nrms_goods_receipt_supplierInvoiceId_idx` ON `nrms_goods_receipt`(`supplierInvoiceId`);

-- AddForeignKey
ALTER TABLE `nrms_goods_receipt` ADD CONSTRAINT `nrms_goods_receipt_supplierInvoiceId_fkey` FOREIGN KEY (`supplierInvoiceId`) REFERENCES `nrms_supplier_invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_invoice` ADD CONSTRAINT `nrms_supplier_invoice_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_invoice` ADD CONSTRAINT `nrms_supplier_invoice_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `nrms_supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_payment` ADD CONSTRAINT `nrms_supplier_payment_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_payment` ADD CONSTRAINT `nrms_supplier_payment_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `nrms_supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_supplier_payment` ADD CONSTRAINT `nrms_supplier_payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `nrms_supplier_invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

