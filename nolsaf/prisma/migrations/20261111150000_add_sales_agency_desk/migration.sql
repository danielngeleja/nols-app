-- Sales Agency Desk, phase 1 (prepared 2026-11-11, NOT applied; apply only with Daniel's approval)
--
-- sales_partner_capability     admin-granted Agency Desk capability for an existing sales partner,
--                              with the addendum acceptance evidence and the snapshotted stay rate.
-- sales_agency_link            a partner's booking links. Only the SHA-256 of the link token is stored.
-- booking_channel_attribution  one row per booking at most, written by the server at booking creation.
--
-- Requires the sales partner tables (sales_partner_profile). Additive only: three new tables, no
-- change to existing tables. Valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `booking_channel_attribution`;
--   DROP TABLE `sales_agency_link`;
--   DROP TABLE `sales_partner_capability`;

-- CreateTable
CREATE TABLE `sales_partner_capability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `capability` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    `stayRate` DECIMAL(5, 2) NOT NULL,
    `maxActiveLinks` INTEGER NOT NULL DEFAULT 20,
    `grantReason` VARCHAR(300) NOT NULL,
    `grantedById` INTEGER NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `termsVersion` VARCHAR(20) NOT NULL,
    `acceptedTermsHash` VARCHAR(64) NULL,
    `acceptedName` VARCHAR(160) NULL,
    `acceptedIpAddress` VARCHAR(64) NULL,
    `acceptedUserAgent` VARCHAR(255) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedById` INTEGER NULL,
    `statusReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_partner_capability_capability_status_idx`(`capability`, `status`),
    UNIQUE INDEX `sales_partner_capability_salesPartnerId_capability_key`(`salesPartnerId`, `capability`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_agency_link` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(32) NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `salt` CHAR(32) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `propertyId` INTEGER NULL,
    `clientName` VARCHAR(160) NULL,
    `clientPhone` VARCHAR(40) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `maxUses` INTEGER NULL,
    `useCount` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_agency_link_reference_key`(`reference`),
    UNIQUE INDEX `sales_agency_link_tokenHash_key`(`tokenHash`),
    INDEX `sales_agency_link_salesPartnerId_revokedAt_expiresAt_idx`(`salesPartnerId`, `revokedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_channel_attribution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookingId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `linkId` INTEGER NULL,
    `channel` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `blockedReason` VARCHAR(300) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` INTEGER NULL,
    `voidReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `booking_channel_attribution_bookingId_key`(`bookingId`),
    INDEX `booking_channel_attribution_salesPartnerId_createdAt_idx`(`salesPartnerId`, `createdAt`),
    INDEX `booking_channel_attribution_linkId_idx`(`linkId`),
    INDEX `booking_channel_attribution_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_partner_capability` ADD CONSTRAINT `sales_partner_capability_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_agency_link` ADD CONSTRAINT `sales_agency_link_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_channel_attribution` ADD CONSTRAINT `booking_channel_attribution_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_channel_attribution` ADD CONSTRAINT `booking_channel_attribution_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `sales_agency_link`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

