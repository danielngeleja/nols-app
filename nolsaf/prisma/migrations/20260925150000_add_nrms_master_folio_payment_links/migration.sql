CREATE TABLE `nrms_master_folio_payment_link` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `masterFolioId` INTEGER NOT NULL,
  `publicToken` VARCHAR(80) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `expiresAt` DATETIME(3) NOT NULL,
  `createdById` INTEGER NULL,
  `paidAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `nrms_mf_pay_link_token_uq`(`publicToken`),
  INDEX `nrms_mf_pay_link_folio_status_exp_idx`(`masterFolioId`, `status`, `expiresAt`),
  INDEX `nrms_mf_pay_link_status_exp_idx`(`status`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `nrms_mf_pay_link_folio_fk`
    FOREIGN KEY (`masterFolioId`) REFERENCES `nrms_master_folio`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
