-- NRMS Agent B2B: agency identity, per-hotel links, rate access, booking-request holds,
-- the maxAgents cap, and the reservation.agentPropertyLinkId tag. Scoped to ONLY these
-- changes; unrelated pre-existing schema/index drift is intentionally excluded.

-- AlterTable
ALTER TABLE `owner_payg_account` ADD COLUMN `maxAgents` INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE `reservation` ADD COLUMN `agentPropertyLinkId` INTEGER NULL;

-- CreateTable
CREATE TABLE `nrms_agent_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `primaryUserId` INTEGER NOT NULL,
    `legalName` VARCHAR(200) NOT NULL,
    `tradingName` VARCHAR(200) NULL,
    `registrationNo` VARCHAR(80) NULL,
    `tin` VARCHAR(50) NULL,
    `licenseNo` VARCHAR(80) NULL,
    `contactName` VARCHAR(160) NULL,
    `contactEmail` VARCHAR(200) NULL,
    `contactPhone` VARCHAR(40) NULL,
    `address` VARCHAR(500) NULL,
    `countryCode` VARCHAR(2) NOT NULL DEFAULT 'TZ',
    `documents` JSON NULL,
    `bankDetails` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `verificationStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `verifiedByAdminId` INTEGER NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verificationNote` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nrms_agent_account_primaryUserId_key`(`primaryUserId`),
    INDEX `nrms_agent_account_status_verificationStatus_idx`(`status`, `verificationStatus`),
    INDEX `nrms_agent_account_registrationNo_idx`(`registrationNo`),
    INDEX `nrms_agent_account_tin_idx`(`tin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_agent_property_link` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agentAccountId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'INVITED',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `paymentTerms` VARCHAR(20) NOT NULL DEFAULT 'PREPAID',
    `bookingMode` VARCHAR(20) NOT NULL DEFAULT 'REQUEST',
    `creditLimit` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `decidedByUserId` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `nrms_agent_property_link_propertyId_status_idx`(`propertyId`, `status`),
    INDEX `nrms_agent_property_link_agentAccountId_status_idx`(`agentAccountId`, `status`),
    UNIQUE INDEX `nrms_agent_property_link_agentAccountId_propertyId_key`(`agentAccountId`, `propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_agent_rate_access` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `linkId` INTEGER NOT NULL,
    `ratePlanId` INTEGER NOT NULL,
    `roomTypeId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `nrms_agent_rate_access_linkId_idx`(`linkId`),
    INDEX `nrms_agent_rate_access_ratePlanId_idx`(`ratePlanId`),
    UNIQUE INDEX `nrms_agent_rate_access_linkId_ratePlanId_roomTypeId_key`(`linkId`, `ratePlanId`, `roomTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nrms_agent_booking_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `linkId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `adults` INTEGER NOT NULL DEFAULT 1,
    `children` INTEGER NOT NULL DEFAULT 0,
    `roomTypeId` INTEGER NULL,
    `roomsRequested` INTEGER NOT NULL DEFAULT 1,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `quotedTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `holdExpiresAt` DATETIME(3) NULL,
    `reservationId` INTEGER NULL,
    `decidedByUserId` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionReason` VARCHAR(300) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nrms_agent_booking_request_reservationId_key`(`reservationId`),
    INDEX `nrms_agent_booking_request_linkId_status_idx`(`linkId`, `status`),
    INDEX `nrms_agent_booking_request_propertyId_status_idx`(`propertyId`, `status`),
    INDEX `nrms_agent_booking_request_status_holdExpiresAt_idx`(`status`, `holdExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `reservation_agentPropertyLinkId_idx` ON `reservation`(`agentPropertyLinkId`);

-- AddForeignKey
ALTER TABLE `reservation` ADD CONSTRAINT `reservation_agentPropertyLinkId_fkey` FOREIGN KEY (`agentPropertyLinkId`) REFERENCES `nrms_agent_property_link`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_account` ADD CONSTRAINT `nrms_agent_account_primaryUserId_fkey` FOREIGN KEY (`primaryUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_property_link` ADD CONSTRAINT `nrms_agent_property_link_agentAccountId_fkey` FOREIGN KEY (`agentAccountId`) REFERENCES `nrms_agent_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_property_link` ADD CONSTRAINT `nrms_agent_property_link_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_rate_access` ADD CONSTRAINT `nrms_agent_rate_access_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `nrms_agent_property_link`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_rate_access` ADD CONSTRAINT `nrms_agent_rate_access_ratePlanId_fkey` FOREIGN KEY (`ratePlanId`) REFERENCES `nrms_rate_plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_rate_access` ADD CONSTRAINT `nrms_agent_rate_access_roomTypeId_fkey` FOREIGN KEY (`roomTypeId`) REFERENCES `room_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_booking_request` ADD CONSTRAINT `nrms_agent_booking_request_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `nrms_agent_property_link`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_agent_booking_request` ADD CONSTRAINT `nrms_agent_booking_request_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
