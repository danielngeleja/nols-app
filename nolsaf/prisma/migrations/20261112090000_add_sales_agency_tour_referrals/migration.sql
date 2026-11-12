-- Sales Agency Desk, tour referrals (prepared 2026-11-12, NOT applied; apply only with Daniel's approval)
--
-- sales_agency_link.operatorAgentId / tourPackageId  a partner's link pinned to one operator package.
-- tour_booking_attribution                            one row per tour booking credited to a partner,
--                                                     written by the server when the booking is created.
--
-- Requires 20261111150000_add_sales_agency_desk (sales_agency_link). Two added nullable columns and one
-- new table. Valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `tour_booking_attribution`;
--   ALTER TABLE `sales_agency_link` DROP COLUMN `operatorAgentId`, DROP COLUMN `tourPackageId`;

-- AlterTable
ALTER TABLE `sales_agency_link` ADD COLUMN `operatorAgentId` INTEGER NULL,
    ADD COLUMN `tourPackageId` VARCHAR(120) NULL;

-- CreateTable
CREATE TABLE `tour_booking_attribution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tourBookingId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `linkId` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `blockedReason` VARCHAR(300) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` INTEGER NULL,
    `voidReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tour_booking_attribution_tourBookingId_key`(`tourBookingId`),
    INDEX `tour_booking_attribution_salesPartnerId_createdAt_idx`(`salesPartnerId`, `createdAt`),
    INDEX `tour_booking_attribution_linkId_idx`(`linkId`),
    INDEX `tour_booking_attribution_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tour_booking_attribution` ADD CONSTRAINT `tour_booking_attribution_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tour_booking_attribution` ADD CONSTRAINT `tour_booking_attribution_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `sales_agency_link`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
