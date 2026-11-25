-- Long-stay rentals, milestone 1 (docs/LONG_STAY_RENTALS.md section 12).
--
-- Adds the rental mode on property, the admin grant that lets a landlord list
-- long stays, the monthly terms, the tenant identity check, the tenancy record
-- with its money snapshot, and an append-only tenancy event log. Rates are
-- defaults on systemsetting; each tenancy snapshots its own.
--
-- Additive only: every existing property stays NIGHTLY. MySQL 8 and MariaDB 11.8.
-- Prepared 2026-11-21. Not applied anywhere until Daniel approves.
-- AlterTable
ALTER TABLE `property` ADD COLUMN `rentalMode` VARCHAR(12) NOT NULL DEFAULT 'NIGHTLY';

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `longStayLandlordCapMonths` DECIMAL(4, 2) NOT NULL DEFAULT 0.50,
    ADD COLUMN `longStayLandlordPercent` DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    ADD COLUMN `longStayTenantCapMonths` DECIMAL(4, 2) NOT NULL DEFAULT 0.25,
    ADD COLUMN `longStayTenantPercent` DECIMAL(5, 2) NOT NULL DEFAULT 4.00;

-- CreateTable
CREATE TABLE `long_stay_landlord_grant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `enabledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `enabledById` INTEGER NULL,
    `pausedAt` DATETIME(3) NULL,
    `pauseReason` VARCHAR(300) NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_landlord_grant_userId_key`(`userId`),
    INDEX `long_stay_landlord_grant_enabledById_idx`(`enabledById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `long_stay_listing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `monthlyRent` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `minTermMonths` INTEGER NOT NULL,
    `maxTermMonths` INTEGER NULL,
    `upfrontMonths` INTEGER NOT NULL,
    `furnished` VARCHAR(12) NOT NULL,
    `utilities` JSON NOT NULL,
    `securityDepositMonths` INTEGER NOT NULL DEFAULT 0,
    `noticePeriodDays` INTEGER NOT NULL DEFAULT 30,
    `balanceMethods` JSON NOT NULL,
    `residencyRules` JSON NULL,
    `availableFrom` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_listing_propertyId_key`(`propertyId`),
    INDEX `long_stay_listing_availableFrom_idx`(`availableFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `long_stay_tenant_profile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `idType` VARCHAR(12) NOT NULL,
    `idNumberHash` VARCHAR(64) NOT NULL,
    `idNumberLast4` VARCHAR(4) NOT NULL,
    `idCountry` VARCHAR(2) NULL,
    `documentId` INTEGER NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `rejectReason` VARCHAR(300) NULL,
    `barredAt` DATETIME(3) NULL,
    `barReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `long_stay_tenant_profile_userId_key`(`userId`),
    INDEX `long_stay_tenant_profile_status_submittedAt_idx`(`status`, `submittedAt`),
    INDEX `long_stay_tenant_profile_idNumberHash_idx`(`idNumberHash`),
    INDEX `long_stay_tenant_profile_documentId_idx`(`documentId`),
    INDEX `long_stay_tenant_profile_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenancy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(40) NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `landlordId` INTEGER NOT NULL,
    `tenantId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    `viewingMode` VARCHAR(12) NULL,
    `viewingAt` DATETIME(3) NULL,
    `viewingConfirmedAt` DATETIME(3) NULL,
    `moveInDate` DATE NULL,
    `termMonths` INTEGER NULL,
    `endDate` DATE NULL,
    `offeredAt` DATETIME(3) NULL,
    `offerAcceptedAt` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `monthlyRent` DECIMAL(12, 2) NULL,
    `upfrontMonths` INTEGER NULL,
    `landlordPercent` DECIMAL(5, 2) NULL,
    `tenantPercent` DECIMAL(5, 2) NULL,
    `landlordCapMonths` DECIMAL(4, 2) NULL,
    `tenantCapMonths` DECIMAL(4, 2) NULL,
    `tenantFee` DECIMAL(12, 2) NULL,
    `landlordCommission` DECIMAL(12, 2) NULL,
    `bookingAmount` DECIMAL(12, 2) NULL,
    `balanceDue` DECIMAL(12, 2) NULL,
    `termsSnapshot` JSON NULL,
    `leaseVersion` VARCHAR(20) NULL,
    `leaseHash` VARCHAR(64) NULL,
    `tenantLeaseAcceptedAt` DATETIME(3) NULL,
    `landlordLeaseAcceptedAt` DATETIME(3) NULL,
    `paymentDueAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `paidAmount` DECIMAL(12, 2) NULL,
    `paymentRef` VARCHAR(80) NULL,
    `checkoutSessionId` VARCHAR(120) NULL,
    `landlordBalanceAmount` DECIMAL(12, 2) NULL,
    `landlordBalanceMethod` VARCHAR(20) NULL,
    `landlordConfirmedAt` DATETIME(3) NULL,
    `tenantBalanceAmount` DECIMAL(12, 2) NULL,
    `tenantBalanceMethod` VARCHAR(20) NULL,
    `tenantKeysReceived` BOOLEAN NULL,
    `tenantMatchesListing` BOOLEAN NULL,
    `tenantConfirmedAt` DATETIME(3) NULL,
    `moveInConfirmedAt` DATETIME(3) NULL,
    `moveInConfirmedBy` VARCHAR(16) NULL,
    `balanceMismatch` BOOLEAN NOT NULL DEFAULT false,
    `payoutStatus` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `payoutAmount` DECIMAL(12, 2) NULL,
    `payoutReleasedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(12) NULL,
    `cancelReason` VARCHAR(300) NULL,
    `disputedAt` DATETIME(3) NULL,
    `noticeGivenAt` DATETIME(3) NULL,
    `noticeGivenBy` VARCHAR(12) NULL,
    `endedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenancy_publicRef_key`(`publicRef`),
    UNIQUE INDEX `tenancy_paymentRef_key`(`paymentRef`),
    UNIQUE INDEX `tenancy_checkoutSessionId_key`(`checkoutSessionId`),
    INDEX `tenancy_propertyId_status_idx`(`propertyId`, `status`),
    INDEX `tenancy_landlordId_status_idx`(`landlordId`, `status`),
    INDEX `tenancy_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `tenancy_status_paymentDueAt_idx`(`status`, `paymentDueAt`),
    INDEX `tenancy_status_moveInDate_idx`(`status`, `moveInDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenancy_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenancyId` INTEGER NOT NULL,
    `actorId` INTEGER NULL,
    `actorRole` VARCHAR(12) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `fromStatus` VARCHAR(20) NULL,
    `toStatus` VARCHAR(20) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenancy_event_tenancyId_createdAt_idx`(`tenancyId`, `createdAt`),
    INDEX `tenancy_event_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `property_status_rentalMode_id_idx` ON `property`(`status`, `rentalMode`, `id`);

-- AddForeignKey
ALTER TABLE `long_stay_landlord_grant` ADD CONSTRAINT `long_stay_landlord_grant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_landlord_grant` ADD CONSTRAINT `long_stay_landlord_grant_enabledById_fkey` FOREIGN KEY (`enabledById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_listing` ADD CONSTRAINT `long_stay_listing_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_tenant_profile` ADD CONSTRAINT `long_stay_tenant_profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_tenant_profile` ADD CONSTRAINT `long_stay_tenant_profile_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `userdocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_tenant_profile` ADD CONSTRAINT `long_stay_tenant_profile_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenancy` ADD CONSTRAINT `tenancy_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenancy` ADD CONSTRAINT `tenancy_landlordId_fkey` FOREIGN KEY (`landlordId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenancy` ADD CONSTRAINT `tenancy_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenancy_event` ADD CONSTRAINT `tenancy_event_tenancyId_fkey` FOREIGN KEY (`tenancyId`) REFERENCES `tenancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenancy_event` ADD CONSTRAINT `tenancy_event_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

