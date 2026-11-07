-- Sales lead visits (prepared 2026-11-07, NOT applied; apply only with Daniel's approval)
--
-- A sales partner's on-site check-in at a lead's property: GPS position and
-- accuracy, server receive time (cannot be backdated), device capture time
-- (for check-ins saved offline), a private photo with its SHA-256 hash, the
-- distance from the property or the lead's first check-in, and the warning
-- signs found when it was recorded (flags). Admins can mark a visit reviewed.
--
-- Additive only: one new table, nothing existing changes, so it is safe to
-- apply before the code that uses it is deployed. Plain CREATE TABLE / ADD
-- CONSTRAINT, valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Privacy: location is captured only when the partner taps "Check in", never
-- in the background. The IP is stored as a keyed hash. Photos are private
-- Cloudinary assets opened through short-lived signed links.
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_lead_visit`;

-- CreateTable
CREATE TABLE `sales_lead_visit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'VERIFIED',
    `latitude` DECIMAL(10, 6) NOT NULL,
    `longitude` DECIMAL(10, 6) NOT NULL,
    `accuracyMeters` INTEGER NOT NULL,
    `positionAt` DATETIME(3) NULL,
    `capturedAt` DATETIME(3) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metWith` VARCHAR(20) NOT NULL,
    `note` VARCHAR(500) NULL,
    `photoPublicId` VARCHAR(255) NOT NULL,
    `photoHash` CHAR(64) NOT NULL,
    `photoBytes` INTEGER NOT NULL,
    `photoMime` VARCHAR(40) NOT NULL,
    `referenceSource` VARCHAR(20) NOT NULL,
    `referenceLatitude` DECIMAL(10, 6) NULL,
    `referenceLongitude` DECIMAL(10, 6) NULL,
    `distanceMeters` INTEGER NULL,
    `flags` JSON NULL,
    `userAgent` VARCHAR(255) NULL,
    `ipHash` CHAR(64) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `reviewNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_lead_visit_leadId_receivedAt_idx`(`leadId`, `receivedAt`),
    INDEX `sales_lead_visit_salesPartnerId_receivedAt_idx`(`salesPartnerId`, `receivedAt`),
    INDEX `sales_lead_visit_createdById_idx`(`createdById`),
    INDEX `sales_lead_visit_photoHash_idx`(`photoHash`),
    INDEX `sales_lead_visit_status_receivedAt_idx`(`status`, `receivedAt`),
    INDEX `sales_lead_visit_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_lead_visit` ADD CONSTRAINT `sales_lead_visit_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `sales_lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead_visit` ADD CONSTRAINT `sales_lead_visit_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead_visit` ADD CONSTRAINT `sales_lead_visit_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead_visit` ADD CONSTRAINT `sales_lead_visit_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
