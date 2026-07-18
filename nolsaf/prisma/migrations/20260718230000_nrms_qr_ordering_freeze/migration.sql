-- AlterTable: admin enforcement switch for the public QR ordering surface
ALTER TABLE `property` ADD COLUMN `nrmsQrOrderingFrozenAt` DATETIME(3) NULL;
