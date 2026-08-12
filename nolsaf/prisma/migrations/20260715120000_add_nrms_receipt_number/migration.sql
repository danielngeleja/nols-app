ALTER TABLE `reservation`
  ADD COLUMN `receiptNumber` VARCHAR(32) NULL;

CREATE UNIQUE INDEX `reservation_receiptNumber_key`
  ON `reservation`(`receiptNumber`);
