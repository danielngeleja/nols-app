-- Sales Partners ask NoLSAF to switch long stay on for the owner of an
-- assisted listing (docs/LONG_STAY_RENTALS.md section 15).
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Additive only (one new table, no foreign keys), runs on both MySQL 8
-- (staging) and MariaDB 11.8 (prod). Until it exists the request endpoints
-- answer that the update is needed; nothing else changes.

CREATE TABLE `long_stay_access_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(40) NOT NULL,
    `assistedListingId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_access_request_publicRef_key`(`publicRef`),
    INDEX `long_stay_access_request_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `long_stay_access_request_assistedListingId_status_idx`(`assistedListingId`, `status`),
    INDEX `long_stay_access_request_ownerUserId_idx`(`ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
