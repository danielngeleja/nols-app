ALTER TABLE `propertyavailabilityblock`
  ADD COLUMN `guestName` VARCHAR(160) NULL,
  ADD COLUMN `guestPhone` VARCHAR(40) NULL,
  ADD COLUMN `nationality` VARCHAR(80) NULL,
  ADD COLUMN `roomRate` DECIMAL(12, 2) NULL,
  ADD COLUMN `calculatedAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `amountPaid` DECIMAL(12, 2) NULL,
  ADD COLUMN `paidVia` VARCHAR(20) NULL,
  ADD COLUMN `currency` VARCHAR(8) NULL;
