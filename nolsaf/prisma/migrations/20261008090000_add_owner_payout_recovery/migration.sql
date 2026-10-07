-- Owner payout recovery, Phase 4 (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md).
-- Prepared 2026-10-07. Apply after 20261007090000, with Daniel's approval.
-- Additive only: two new tables. Plain DDL for MySQL 8 and MariaDB 11.8.

CREATE TABLE `owner_payout_recovery` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ownerId` INTEGER NOT NULL,
  `bookingId` INTEGER NOT NULL,
  `sourceInvoiceId` INTEGER NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `reference` VARCHAR(120) NOT NULL,
  `guestAmount` DECIMAL(12, 2) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `recoveredAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `dueAt` DATETIME(3) NOT NULL,
  `repayRequestedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdById` INTEGER NULL,
  `note` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `owner_payout_recovery_kind_reference_key`(`kind`, `reference`),
  INDEX `owner_payout_recovery_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `owner_payout_recovery_bookingId_idx`(`bookingId`),
  INDEX `owner_payout_recovery_status_dueAt_idx`(`status`, `dueAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `owner_payout_recovery_application` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `recoveryId` INTEGER NOT NULL,
  `invoiceId` INTEGER NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `owner_payout_recovery_application_recoveryId_invoiceId_key`(`recoveryId`, `invoiceId`),
  INDEX `owner_payout_recovery_application_invoiceId_idx`(`invoiceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `owner_payout_recovery_application_recoveryId_fkey` FOREIGN KEY (`recoveryId`) REFERENCES `owner_payout_recovery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
