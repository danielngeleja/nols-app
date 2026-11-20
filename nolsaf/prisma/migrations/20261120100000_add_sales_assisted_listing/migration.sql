-- Sales assisted listing (docs/SALES_ASSISTED_LISTING.md).
--
-- sales_partner_profile.assistedListingEnabledAt   admin grant (null = not allowed)
-- sales_partner_profile.assistedListingPausedAt    admin or automatic pause
-- sales_assisted_listing                           one row per lead/property listed
--                                                  by a partner for the owner
--
-- Additive only. Runs on MySQL 8 (staging) and MariaDB 11.8 (prod).
-- Prepared 2026-11-20. Not applied anywhere until Daniel approves.

-- AlterTable
ALTER TABLE `sales_partner_profile` ADD COLUMN `assistedListingEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `assistedListingPauseReason` VARCHAR(300) NULL,
    ADD COLUMN `assistedListingPausedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `sales_assisted_listing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `visitId` INTEGER NOT NULL,
    `ownerAccountOutcome` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFTING',
    `objectionReferenceHash` CHAR(64) NOT NULL,
    `noticeSentAt` DATETIME(3) NULL,
    `liveNoticeSentAt` DATETIME(3) NULL,
    `objectedAt` DATETIME(3) NULL,
    `objectionNote` VARCHAR(500) NULL,
    `statusBeforeObjection` VARCHAR(20) NULL,
    `objectionResolvedAt` DATETIME(3) NULL,
    `objectionResolvedById` INTEGER NULL,
    `objectionOutcome` VARCHAR(10) NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `returnReasons` JSON NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_assisted_listing_leadId_key`(`leadId`),
    UNIQUE INDEX `sales_assisted_listing_propertyId_key`(`propertyId`),
    UNIQUE INDEX `sales_assisted_listing_objectionReferenceHash_key`(`objectionReferenceHash`),
    INDEX `sales_assisted_listing_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_assisted_listing_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `sales_assisted_listing_ownerUserId_idx`(`ownerUserId`),
    INDEX `sales_assisted_listing_visitId_idx`(`visitId`),
    INDEX `sales_assisted_listing_objectionResolvedById_idx`(`objectionResolvedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `sales_lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `sales_lead_visit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_objectionResolvedById_fkey` FOREIGN KEY (`objectionResolvedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

