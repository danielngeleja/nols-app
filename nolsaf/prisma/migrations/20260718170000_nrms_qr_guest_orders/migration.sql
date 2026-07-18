-- AlterTable: outlet gains the QR auto-accept toggle
ALTER TABLE `nrms_outlet` ADD COLUMN `autoAcceptQrOrders` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: orders gain QR origin fields
ALTER TABLE `nrms_outlet_order` ADD COLUMN `orderPointId` INTEGER NULL,
    ADD COLUMN `publicCode` VARCHAR(40) NULL,
    ADD COLUMN `placedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `nrms_outlet_order_publicCode_key` ON `nrms_outlet_order`(`publicCode`);

-- CreateIndex
CREATE INDEX `nrms_outlet_order_orderPointId_status_idx` ON `nrms_outlet_order`(`orderPointId`, `status`);

-- AddForeignKey
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_orderPointId_fkey` FOREIGN KEY (`orderPointId`) REFERENCES `nrms_order_point`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
