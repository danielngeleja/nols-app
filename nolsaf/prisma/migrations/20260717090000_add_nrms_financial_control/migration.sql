-- NRMS Financial Control: business dates, Night Audit, cashier variance,
-- immutable double-entry ledgers, outlet tenders and NBS bed capacity.

ALTER TABLE `room_unit`
  ADD COLUMN `bedCount` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `nrms_outlet_order`
  ADD COLUMN `settlementMethod` VARCHAR(30) NULL,
  ADD COLUMN `settledById` INTEGER NULL;

CREATE INDEX `nrms_outlet_order_settledById_idx` ON `nrms_outlet_order`(`settledById`);
ALTER TABLE `nrms_outlet_order`
  ADD CONSTRAINT `nrms_outlet_order_settledById_fkey`
  FOREIGN KEY (`settledById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `nrms_business_day` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `businessDate` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `openedById` INTEGER NULL,
  `closedById` INTEGER NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  UNIQUE INDEX `nrms_business_day_propertyId_businessDate_key`(`propertyId`, `businessDate`),
  INDEX `nrms_business_day_propertyId_status_businessDate_idx`(`propertyId`, `status`, `businessDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_night_audit_run` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `businessDayId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `reportNumber` VARCHAR(48) NOT NULL,
  `blockers` JSON NULL,
  `warnings` JSON NULL,
  `summary` JSON NULL,
  `startedById` INTEGER NULL,
  `closedById` INTEGER NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `nrms_night_audit_run_reportNumber_key`(`reportNumber`),
  INDEX `nrms_night_audit_run_propertyId_startedAt_idx`(`propertyId`, `startedAt`),
  INDEX `nrms_night_audit_run_businessDayId_status_idx`(`businessDayId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_cashier_shift` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `businessDayId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `businessDate` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `openingFloat` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `expectedCash` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `declaredCash` DECIMAL(12,2) NULL,
  `variance` DECIMAL(12,2) NULL,
  `closeNote` VARCHAR(300) NULL,
  `approvedById` INTEGER NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  INDEX `nrms_cashier_shift_propertyId_businessDate_status_idx`(`propertyId`, `businessDate`, `status`),
  INDEX `nrms_cashier_shift_userId_openedAt_idx`(`userId`, `openedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_ledger_transaction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `businessDayId` INTEGER NOT NULL,
  `nightAuditRunId` INTEGER NULL,
  `transactionNumber` VARCHAR(48) NOT NULL,
  `sourceKey` VARCHAR(100) NOT NULL,
  `sourceType` VARCHAR(30) NOT NULL,
  `sourceId` INTEGER NULL,
  `description` VARCHAR(300) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `occurredAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_ledger_transaction_transactionNumber_key`(`transactionNumber`),
  UNIQUE INDEX `nrms_ledger_transaction_sourceKey_key`(`sourceKey`),
  INDEX `nrms_ledger_transaction_propertyId_occurredAt_idx`(`propertyId`, `occurredAt`),
  INDEX `nrms_ledger_transaction_businessDayId_sourceType_idx`(`businessDayId`, `sourceType`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_ledger_entry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `transactionId` INTEGER NOT NULL,
  `accountCode` VARCHAR(20) NOT NULL,
  `accountName` VARCHAR(100) NOT NULL,
  `accountType` VARCHAR(20) NOT NULL,
  `debit` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `credit` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `description` VARCHAR(300) NULL,
  INDEX `nrms_ledger_entry_accountCode_transactionId_idx`(`accountCode`, `transactionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_business_day`
  ADD CONSTRAINT `nrms_business_day_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_business_day_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_business_day_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_night_audit_run`
  ADD CONSTRAINT `nrms_night_audit_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_cashier_shift`
  ADD CONSTRAINT `nrms_cashier_shift_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_cashier_shift_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_cashier_shift_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_cashier_shift_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_ledger_transaction`
  ADD CONSTRAINT `nrms_ledger_tx_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_ledger_tx_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_ledger_tx_nightAuditRunId_fkey` FOREIGN KEY (`nightAuditRunId`) REFERENCES `nrms_night_audit_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_ledger_entry`
  ADD CONSTRAINT `nrms_ledger_entry_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `nrms_ledger_transaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Old outlet settlements predate tender capture. They stay visibly OTHER until
-- a manager classifies them; Night Audit never guesses that they were cash.
UPDATE `nrms_outlet_order`
SET `settlementMethod` = 'OTHER'
WHERE `settlementMode` = 'OUTLET_PAYMENT' AND `status` = 'SETTLED' AND `settlementMethod` IS NULL;
