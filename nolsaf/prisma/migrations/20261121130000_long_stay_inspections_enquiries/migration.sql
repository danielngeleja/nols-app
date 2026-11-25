-- Long-stay rentals: Sales Partner inspections and Ask NoLSAF (docs/LONG_STAY_RENTALS.md section 13).
--
-- Every long-stay home is inspected on site by a NoLSAF Sales Partner before
-- it is approved or takes reservations; tenants' questions and visit requests
-- go to NoLSAF, not the landlord. The partner's flat inspection fee is a
-- SystemSetting. Runs on MySQL 8 and MariaDB 11.8. Apply after 20261121120000.

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `longStayInspectionFee` DECIMAL(12, 2) NOT NULL DEFAULT 25000.00;

-- CreateTable
CREATE TABLE `long_stay_inspection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(40) NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    `reason` VARCHAR(16) NOT NULL DEFAULT 'FIRST',
    `salesPartnerId` INTEGER NULL,
    `assignedById` INTEGER NULL,
    `assignedAt` DATETIME(3) NULL,
    `dueBy` DATETIME(3) NULL,
    `checklist` JSON NULL,
    `photos` JSON NULL,
    `recommendation` VARCHAR(8) NULL,
    `note` VARCHAR(1000) NULL,
    `latitude` DECIMAL(10, 6) NULL,
    `longitude` DECIMAL(10, 6) NULL,
    `accuracyMeters` INTEGER NULL,
    `distanceMeters` INTEGER NULL,
    `flags` JSON NULL,
    `capturedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `reviewNote` VARCHAR(500) NULL,
    `validUntil` DATE NULL,
    `feeAmount` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_inspection_publicRef_key`(`publicRef`),
    INDEX `long_stay_inspection_propertyId_status_idx`(`propertyId`, `status`),
    INDEX `long_stay_inspection_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `long_stay_inspection_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `long_stay_inspection_assignedById_idx`(`assignedById`),
    INDEX `long_stay_inspection_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `long_stay_enquiry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(40) NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `text` VARCHAR(1000) NOT NULL,
    `slots` JSON NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    `answer` VARCHAR(1000) NULL,
    `answeredById` INTEGER NULL,
    `answeredAt` DATETIME(3) NULL,
    `visitAt` DATETIME(3) NULL,
    `salesPartnerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_enquiry_publicRef_key`(`publicRef`),
    INDEX `long_stay_enquiry_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `long_stay_enquiry_propertyId_idx`(`propertyId`),
    INDEX `long_stay_enquiry_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `long_stay_enquiry_answeredById_idx`(`answeredById`),
    INDEX `long_stay_enquiry_salesPartnerId_idx`(`salesPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `long_stay_inspection` ADD CONSTRAINT `long_stay_inspection_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_inspection` ADD CONSTRAINT `long_stay_inspection_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_inspection` ADD CONSTRAINT `long_stay_inspection_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_inspection` ADD CONSTRAINT `long_stay_inspection_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_enquiry` ADD CONSTRAINT `long_stay_enquiry_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_enquiry` ADD CONSTRAINT `long_stay_enquiry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_enquiry` ADD CONSTRAINT `long_stay_enquiry_answeredById_fkey` FOREIGN KEY (`answeredById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_enquiry` ADD CONSTRAINT `long_stay_enquiry_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

