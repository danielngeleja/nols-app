-- Sales Agency Desk, phase 2 (prepared 2026-11-11, NOT applied; apply only with Daniel's approval)
--
-- group_bookings.paymentMode   DEPOSIT (today's flow) or FULL (Agency Desk groups: the guest pays
--                              everything to NoLSAF and NoLSAF pays the owner after check-in).
--                              Existing rows default to DEPOSIT, so nothing changes for them.
-- sales_client_account         the partner's client book (organisers and institutions).
-- sales_client_activity        append-only client timeline.
-- sales_agency_group_request   a group stay a partner prepares; becomes a group booking only when
--                              the client confirms from their own phone. Token stored as SHA-256.
--
-- Requires 20261111150000_add_sales_agency_desk. One added column with a default (instant on
-- MySQL 8 and MariaDB 11.8) and three new tables. Valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_agency_group_request`;
--   DROP TABLE `sales_client_activity`;
--   DROP TABLE `sales_client_account`;
--   ALTER TABLE `group_bookings` DROP COLUMN `paymentMode`;

-- AlterTable
ALTER TABLE `group_bookings` ADD COLUMN `paymentMode` VARCHAR(10) NOT NULL DEFAULT 'DEPOSIT';

-- CreateTable
CREATE TABLE `sales_client_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(32) NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `nameNormalized` VARCHAR(200) NOT NULL,
    `contactName` VARCHAR(160) NULL,
    `phone` VARCHAR(40) NULL,
    `phoneKey` VARCHAR(20) NULL,
    `email` VARCHAR(190) NULL,
    `emailNormalized` VARCHAR(190) NULL,
    `region` VARCHAR(120) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `duplicateReviewStatus` VARCHAR(30) NOT NULL DEFAULT 'CLEAR',
    `protectionExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_client_account_reference_key`(`reference`),
    INDEX `sales_client_account_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_client_account_phoneKey_idx`(`phoneKey`),
    INDEX `sales_client_account_emailNormalized_idx`(`emailNormalized`),
    INDEX `sales_client_account_nameNormalized_idx`(`nameNormalized`),
    INDEX `sales_client_account_protectionExpiresAt_idx`(`protectionExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_client_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `description` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_client_activity_clientId_createdAt_idx`(`clientId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_agency_group_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(32) NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `clientId` INTEGER NULL,
    `clientName` VARCHAR(160) NOT NULL,
    `clientPhone` VARCHAR(40) NOT NULL,
    `clientPhoneKey` VARCHAR(20) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'AWAITING_CLIENT',
    `tokenHash` CHAR(64) NOT NULL,
    `tokenExpiresAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,
    `confirmedUserId` INTEGER NULL,
    `groupBookingId` INTEGER NULL,
    `biddingDays` INTEGER NOT NULL DEFAULT 3,
    `shortlistPropertyIds` JSON NULL,
    `shortlistStatus` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `shortlistReviewedAt` DATETIME(3) NULL,
    `shortlistReviewedById` INTEGER NULL,
    `pendingLeadIds` JSON NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_agency_group_request_reference_key`(`reference`),
    UNIQUE INDEX `sales_agency_group_request_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `sales_agency_group_request_groupBookingId_key`(`groupBookingId`),
    INDEX `sales_agency_group_request_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_agency_group_request_clientId_idx`(`clientId`),
    INDEX `sales_agency_group_request_shortlistStatus_idx`(`shortlistStatus`),
    INDEX `sales_agency_group_request_status_tokenExpiresAt_idx`(`status`, `tokenExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_client_account` ADD CONSTRAINT `sales_client_account_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_client_activity` ADD CONSTRAINT `sales_client_activity_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `sales_client_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_agency_group_request` ADD CONSTRAINT `sales_agency_group_request_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_agency_group_request` ADD CONSTRAINT `sales_agency_group_request_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `sales_client_account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

