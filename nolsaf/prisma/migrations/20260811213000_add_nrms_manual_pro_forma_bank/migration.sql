-- Manual bank instructions for property-issued Pro Formas. These records are
-- deliberately separate from payout_account and are never treated as AzamPay
-- or NoLSAF-verified payout destinations.

CREATE TABLE `nrms_pro_forma_bank_account` (
  `id`                   INT NOT NULL AUTO_INCREMENT,
  `propertyId`           INT NOT NULL,
  `ownerId`              INT NOT NULL,
  `bankName`             VARCHAR(120) NOT NULL,
  `accountName`          VARCHAR(160) NOT NULL,
  `accountNumberEnc`     TEXT NOT NULL,
  `accountCurrency`      VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `branchName`           VARCHAR(120) NULL,
  `bankAddress`          VARCHAR(240) NULL,
  `swiftCode`            VARCHAR(32) NULL,
  `iban`                 VARCHAR(64) NULL,
  `routingCode`          VARCHAR(64) NULL,
  `instructions`         VARCHAR(500) NULL,
  `active`               BOOLEAN NOT NULL DEFAULT TRUE,
  `policyVersion`        VARCHAR(30) NOT NULL,
  `policyAcceptedAt`     DATETIME(3) NOT NULL,
  `policyAcceptedById`   INT NOT NULL,
  `createdAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_pro_forma_bank_account_propertyId_key` (`propertyId`),
  KEY `nrms_pro_forma_bank_account_ownerId_active_idx` (`ownerId`, `active`),
  KEY `nrms_pro_forma_bank_account_policyAcceptedById_fkey` (`policyAcceptedById`),
  CONSTRAINT `nrms_pro_forma_bank_account_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_pro_forma_bank_account_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_pro_forma_bank_account_policyAcceptedById_fkey`
    FOREIGN KEY (`policyAcceptedById`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `nrms_master_folio_pro_forma`
  ADD COLUMN `bankSource` VARCHAR(30) NOT NULL DEFAULT 'VERIFIED_PAYOUT' AFTER `bankBranch`,
  ADD COLUMN `bankCurrency` VARCHAR(3) NULL AFTER `bankSource`,
  ADD COLUMN `bankAddress` VARCHAR(240) NULL AFTER `bankCurrency`,
  ADD COLUMN `bankSwiftCode` VARCHAR(32) NULL AFTER `bankAddress`,
  ADD COLUMN `bankIban` VARCHAR(64) NULL AFTER `bankSwiftCode`,
  ADD COLUMN `bankRoutingCode` VARCHAR(64) NULL AFTER `bankIban`,
  ADD COLUMN `bankInstructions` VARCHAR(500) NULL AFTER `bankRoutingCode`;
