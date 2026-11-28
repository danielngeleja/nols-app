-- CreateTable
CREATE TABLE `event_hire_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `clientUserId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NULL,
    `assisted` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(24) NOT NULL DEFAULT 'WAITING_OWNER',
    `version` INTEGER NOT NULL DEFAULT 1,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `holdExpiresAt` DATETIME(3) NULL,
    `eventType` VARCHAR(24) NOT NULL,
    `people` INTEGER NOT NULL,
    `seating` VARCHAR(12) NOT NULL,
    `package` VARCHAR(12) NOT NULL,
    `termsFingerprint` CHAR(64) NOT NULL,
    `quote` JSON NOT NULL,
    `termsSnapshot` JSON NOT NULL,
    `ownerConfirmedAt` DATETIME(3) NULL,
    `confirmedOwnerId` INTEGER NULL,
    `confirmationVia` VARCHAR(12) NULL,
    `partnerApprovedAt` DATETIME(3) NULL,
    `reminderAt` DATETIME(3) NOT NULL,
    `escalateAt` DATETIME(3) NOT NULL,
    `remindedAt` DATETIME(3) NULL,
    `escalatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_hire_request_reference_key`(`reference`),
    INDEX `event_hire_request_propertyId_startsAt_endsAt_idx`(`propertyId`, `startsAt`, `endsAt`),
    INDEX `event_hire_request_clientUserId_createdAt_idx`(`clientUserId`, `createdAt`),
    INDEX `event_hire_request_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `event_hire_request_status_escalateAt_idx`(`status`, `escalateAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_request_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `actorUserId` INTEGER NULL,
    `action` VARCHAR(32) NOT NULL,
    `details` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_hire_request_event_requestId_createdAt_idx`(`requestId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_block` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(24) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_hire_block_reference_key`(`reference`),
    INDEX `event_hire_block_propertyId_startsAt_endsAt_idx`(`propertyId`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_hire_request` ADD CONSTRAINT `event_hire_request_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_request` ADD CONSTRAINT `event_hire_request_clientUserId_fkey` FOREIGN KEY (`clientUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_request` ADD CONSTRAINT `event_hire_request_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_request_event` ADD CONSTRAINT `event_hire_request_event_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `event_hire_request`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_block` ADD CONSTRAINT `event_hire_block_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
