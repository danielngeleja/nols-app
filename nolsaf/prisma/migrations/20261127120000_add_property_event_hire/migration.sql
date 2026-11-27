-- Hire for events add-on, phase E1 (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md):
-- one row per property with the owner's declared event terms, consent and the
-- admin review state.
-- Prepared 2026-11-27. NOT APPLIED. Apply only with Daniel's approval.
-- One new table and one FK to Property; no change to existing tables: runs on
-- both MySQL 8 (staging) and MariaDB 11.8 (prod).

CREATE TABLE `property_event_hire` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `terms` JSON NOT NULL,
    `termsFingerprint` CHAR(64) NOT NULL,
    `filledBy` VARCHAR(16) NOT NULL,
    `filledByUserId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NULL,
    `ownerConsentFingerprint` CHAR(64) NULL,
    `ownerConsentAt` DATETIME(3) NULL,
    `ownerConsentVia` VARCHAR(10) NULL,
    `confirmTokenHash` CHAR(64) NULL,
    `confirmSentAt` DATETIME(3) NULL,
    `confirmOpenedAt` DATETIME(3) NULL,
    `ownerObjectionNote` VARCHAR(500) NULL,
    `ownerObjectedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `approvedFingerprint` CHAR(64) NULL,
    `returnReason` VARCHAR(500) NULL,
    `pausedAt` DATETIME(3) NULL,
    `pauseReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `property_event_hire_propertyId_key`(`propertyId`),
    UNIQUE INDEX `property_event_hire_confirmTokenHash_key`(`confirmTokenHash`),
    INDEX `property_event_hire_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `property_event_hire_salesPartnerId_idx`(`salesPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `property_event_hire` ADD CONSTRAINT `property_event_hire_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
