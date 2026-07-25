-- NRMS operating expenses (staff wages, utilities, supplies, maintenance,
-- marketing, rent, licensing, other). Immutable rows with void-and-reason
-- correction, mirroring reservation_charge. Feeds the Profit and Loss
-- report and posts to the general ledger at Night Audit close the same
-- way charges and payments do. Purely additive: no existing table is
-- dropped or rewritten.

CREATE TABLE IF NOT EXISTS `nrms_expense` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `description` VARCHAR(300) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `paymentMethod` VARCHAR(30) NULL,
  `incurredAt` DATETIME(3) NOT NULL,
  `recordedById` INT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidReason` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `nrms_expense_propertyId_incurredAt_idx` (`propertyId`, `incurredAt`),
  KEY `nrms_expense_category_idx` (`category`),
  CONSTRAINT `nrms_expense_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_expense_recordedById_fkey`
    FOREIGN KEY (`recordedById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
