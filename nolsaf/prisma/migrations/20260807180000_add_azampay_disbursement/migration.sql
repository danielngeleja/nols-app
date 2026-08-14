-- DRAFT migration, hand-written for review. NOT applied to any database.
--
-- Written by hand instead of via `prisma migrate dev` because the shadow
-- database diff failed on a pre-existing, unrelated migration
-- (20260714130000_reconcile_legacy_database_drift uses `DROP FOREIGN KEY IF
-- EXISTS`, which this MySQL version rejects). That failure blocks Prisma's
-- automatic diff tooling for any new migration until it is fixed
-- separately; it is not caused by and does not affect the tables below.
--
-- Adds the shared AzamPay disbursement engine described in
-- docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md: one payout_account +
-- disbursement + disbursement_event set, reused across all four money-out
-- flows (owner/operator, tours, drivers, sales partners) via
-- sourceType/sourceId rather than a bespoke table per flow.

-- CreateTable
CREATE TABLE `payout_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `accountNumber` VARCHAR(40) NOT NULL,
    `accountName` VARCHAR(160) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `verifiedAt` DATETIME(3) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payout_account_userId_provider_accountNumber_key`(`userId`, `provider`, `accountNumber`),
    INDEX `payout_account_userId_isActive_idx`(`userId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disbursement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `externalReferenceId` VARCHAR(30) NOT NULL,
    `pgReferenceId` VARCHAR(64) NULL,
    `fspReferenceId` VARCHAR(64) NULL,
    `sourceType` VARCHAR(20) NOT NULL,
    `sourceId` INTEGER NOT NULL,
    `payoutAccountId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    `provider` VARCHAR(20) NOT NULL DEFAULT 'azampay',
    `bankName` VARCHAR(30) NOT NULL,
    `operator` VARCHAR(40) NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `providerMessage` VARCHAR(300) NULL,
    `rawRequest` JSON NULL,
    `rawResponse` JSON NULL,
    `remarks` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `disbursement_externalReferenceId_key`(`externalReferenceId`),
    UNIQUE INDEX `disbursement_pgReferenceId_key`(`pgReferenceId`),
    INDEX `disbursement_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `disbursement_status_submittedAt_idx`(`status`, `submittedAt`),
    INDEX `disbursement_payoutAccountId_idx`(`payoutAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disbursement_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `disbursementId` INTEGER NOT NULL,
    `eventType` VARCHAR(30) NOT NULL,
    `eventHash` VARCHAR(80) NOT NULL,
    `status` VARCHAR(20) NULL,
    `message` VARCHAR(300) NULL,
    `pgReferenceId` VARCHAR(64) NULL,
    `fspReferenceId` VARCHAR(64) NULL,
    `amount` DECIMAL(12, 2) NULL,
    `operator` VARCHAR(40) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `disbursement_event_eventHash_key`(`eventHash`),
    INDEX `disbursement_event_disbursementId_idx`(`disbursementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payout_account` ADD CONSTRAINT `payout_account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement` ADD CONSTRAINT `disbursement_payoutAccountId_fkey` FOREIGN KEY (`payoutAccountId`) REFERENCES `payout_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement` ADD CONSTRAINT `disbursement_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement_event` ADD CONSTRAINT `disbursement_event_disbursementId_fkey` FOREIGN KEY (`disbursementId`) REFERENCES `disbursement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
