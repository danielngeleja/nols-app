-- Owner "Request a NoLSAF visit" (docs/SALES_VISIT_REQUESTS.md).
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Additive only: one new table, no foreign keys. Runs on MySQL 8 (staging)
-- and MariaDB 11.8 (prod). Apply after 20261126120000_add_sales_regions,
-- which the region routing reads.

CREATE TABLE `sales_visit_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `regionId` INTEGER NULL,
    `contactName` VARCHAR(160) NOT NULL,
    `contactPhone` VARCHAR(40) NOT NULL,
    `contactPhoneNormalized` VARCHAR(40) NOT NULL,
    `contactEmail` VARCHAR(190) NULL,
    `propertyName` VARCHAR(200) NOT NULL,
    `propertyType` VARCHAR(60) NULL,
    `estimatedRooms` INTEGER NULL,
    `location` VARCHAR(200) NOT NULL,
    `interest` VARCHAR(30) NOT NULL,
    `message` VARCHAR(1000) NULL,
    `ipHash` CHAR(64) NULL,
    `assignedPartnerId` INTEGER NULL,
    `assignedById` INTEGER NULL,
    `assignedByRole` VARCHAR(16) NULL,
    `assignedAt` DATETIME(3) NULL,
    `leadId` INTEGER NULL,
    `closedReason` VARCHAR(300) NULL,
    `closedById` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_visit_request_publicRef_key`(`publicRef`),
    INDEX `sales_visit_request_status_regionId_idx`(`status`, `regionId`),
    INDEX `sales_visit_request_contactPhoneNormalized_idx`(`contactPhoneNormalized`),
    INDEX `sales_visit_request_assignedPartnerId_idx`(`assignedPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
