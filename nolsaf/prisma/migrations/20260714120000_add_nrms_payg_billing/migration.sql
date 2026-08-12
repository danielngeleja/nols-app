CREATE TABLE `nrms_usage_charge_policy` (
  `id` INT NOT NULL AUTO_INCREMENT, `version` VARCHAR(60) NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `effectiveFrom` DATETIME(3) NOT NULL, `effectiveTo` DATETIME(3) NULL, `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `roomNightPrice` DECIMAL(12,2) NOT NULL, `trialDays` INT NOT NULL DEFAULT 45,
  `reminderAmount` DECIMAL(12,2) NOT NULL DEFAULT 25000.00, `warningAmount` DECIMAL(12,2) NOT NULL DEFAULT 40000.00,
  `unpaidLimit` DECIMAL(12,2) NOT NULL DEFAULT 50000.00, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `nrms_usage_charge_policy_version_key` (`version`),
  KEY `nrms_usage_charge_policy_status_effectiveFrom_idx` (`status`,`effectiveFrom`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_payg_account` (
  `id` INT NOT NULL AUTO_INCREMENT, `propertyId` INT NOT NULL, `ownerId` INT NOT NULL, `policyId` INT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'TRIAL', `trialStartsAt` DATETIME(3) NOT NULL, `trialEndsAt` DATETIME(3) NOT NULL,
  `unpaidBalance` DECIMAL(12,2) NOT NULL DEFAULT 0.00, `unpaidLimit` DECIMAL(12,2) NOT NULL DEFAULT 50000.00,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `owner_payg_account_propertyId_key` (`propertyId`),
  KEY `owner_payg_account_ownerId_status_idx` (`ownerId`,`status`), KEY `owner_payg_account_status_unpaidBalance_idx` (`status`,`unpaidBalance`),
  CONSTRAINT `owner_payg_account_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `owner_payg_account_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `owner_payg_account_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `nrms_usage_charge_policy` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_usage_event` (
  `id` INT NOT NULL AUTO_INCREMENT, `accountId` INT NOT NULL, `propertyId` INT NOT NULL, `reservationId` INT NOT NULL,
  `allocationId` INT NOT NULL, `policyId` INT NOT NULL, `serviceDate` DATE NOT NULL, `classification` VARCHAR(30) NOT NULL,
  `source` VARCHAR(20) NOT NULL, `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS', `amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_usage_event_allocationId_serviceDate_policyId_key` (`allocationId`,`serviceDate`,`policyId`),
  KEY `nrms_usage_event_accountId_createdAt_idx` (`accountId`,`createdAt`), KEY `nrms_usage_event_propertyId_serviceDate_idx` (`propertyId`,`serviceDate`),
  CONSTRAINT `nrms_usage_event_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `owner_payg_account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nrms_usage_event_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nrms_usage_event_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nrms_usage_event_allocationId_fkey` FOREIGN KEY (`allocationId`) REFERENCES `reservation_room_allocation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nrms_usage_event_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `nrms_usage_charge_policy` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_billing_statement` (
  `id` INT NOT NULL AUTO_INCREMENT, `accountId` INT NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'PAYABLE',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS', `amount` DECIMAL(12,2) NOT NULL, `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paidAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  KEY `nrms_billing_statement_accountId_status_idx` (`accountId`,`status`),
  CONSTRAINT `nrms_billing_statement_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `owner_payg_account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_billing_statement_item` (
  `id` INT NOT NULL AUTO_INCREMENT, `statementId` INT NOT NULL, `usageEventId` INT NOT NULL, `amount` DECIMAL(12,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), UNIQUE KEY `nrms_billing_statement_item_usageEventId_key` (`usageEventId`),
  KEY `nrms_billing_statement_item_statementId_idx` (`statementId`),
  CONSTRAINT `nrms_billing_statement_item_statementId_fkey` FOREIGN KEY (`statementId`) REFERENCES `nrms_billing_statement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nrms_billing_statement_item_usageEventId_fkey` FOREIGN KEY (`usageEventId`) REFERENCES `nrms_usage_event` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_service_payment_token` (
  `id` INT NOT NULL AUTO_INCREMENT, `statementId` INT NOT NULL, `token` VARCHAR(80) NOT NULL, `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS', `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING', `method` VARCHAR(30) NULL,
  `expiresAt` DATETIME(3) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_service_payment_token_token_key` (`token`), KEY `nrms_service_payment_token_statementId_status_idx` (`statementId`,`status`),
  CONSTRAINT `nrms_service_payment_token_statementId_fkey` FOREIGN KEY (`statementId`) REFERENCES `nrms_billing_statement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_service_payment` (
  `id` INT NOT NULL AUTO_INCREMENT, `tokenId` INT NOT NULL, `provider` VARCHAR(30) NOT NULL, `providerRef` VARCHAR(120) NOT NULL,
  `idempotencyKey` VARCHAR(120) NOT NULL, `amount` DECIMAL(12,2) NOT NULL, `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status` VARCHAR(20) NOT NULL, `verifiedAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_service_payment_tokenId_key` (`tokenId`), UNIQUE KEY `nrms_service_payment_providerRef_key` (`providerRef`),
  UNIQUE KEY `nrms_service_payment_idempotencyKey_key` (`idempotencyKey`), KEY `nrms_service_payment_status_createdAt_idx` (`status`,`createdAt`),
  CONSTRAINT `nrms_service_payment_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `nrms_service_payment_token` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `nrms_usage_charge_policy` (`version`,`status`,`effectiveFrom`,`currency`,`roomNightPrice`,`trialDays`,`reminderAmount`,`warningAmount`,`unpaidLimit`)
VALUES ('NRMS-2026-07-BASELINE','ACTIVE','2026-07-01 00:00:00.000','TZS',500.00,45,25000.00,40000.00,50000.00)
ON DUPLICATE KEY UPDATE `version`=`version`;
