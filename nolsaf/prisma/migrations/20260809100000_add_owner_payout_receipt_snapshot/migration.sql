ALTER TABLE `invoice`
  ADD COLUMN `receiptSnapshot` JSON NULL,
  ADD COLUMN `receiptIssuedAt` DATETIME(3) NULL;
