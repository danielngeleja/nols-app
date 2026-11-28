-- CreateTable
CREATE TABLE `event_hire_booking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `requestId` INTEGER NOT NULL,
    `ownerId` INTEGER NOT NULL,
    `clientName` VARCHAR(160) NOT NULL,
    `venueTitle` VARCHAR(200) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'AWAITING_PAYMENT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `total` INTEGER NOT NULL,
    `ownerDue` INTEGER NOT NULL,
    `deposit` INTEGER NOT NULL,
    `fee` INTEGER NOT NULL,
    `cleaningFee` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'TZS',
    `paymentRef` VARCHAR(40) NOT NULL,
    `callbackTokenHash` CHAR(64) NOT NULL,
    `checkoutStatus` VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    `checkoutUrl` VARCHAR(2048) NULL,
    `checkoutExpiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `providerTransactionId` VARCHAR(80) NULL,
    `ownerCompletedAt` DATETIME(3) NULL,
    `clientCompletedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `settlementPreparedAt` DATETIME(3) NULL,
    `cancellationRequestedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancellationReason` VARCHAR(500) NULL,
    `claimDeadline` DATETIME(3) NOT NULL,
    `depositStatus` VARCHAR(24) NOT NULL DEFAULT 'UNPAID',
    `payoutStatus` VARCHAR(24) NOT NULL DEFAULT 'UNPAID',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_hire_booking_reference_key`(`reference`),
    UNIQUE INDEX `event_hire_booking_requestId_key`(`requestId`),
    UNIQUE INDEX `event_hire_booking_paymentRef_key`(`paymentRef`),
    UNIQUE INDEX `event_hire_booking_providerTransactionId_key`(`providerTransactionId`),
    INDEX `event_hire_booking_status_checkoutExpiresAt_idx`(`status`, `checkoutExpiresAt`),
    INDEX `event_hire_booking_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `bookingId` INTEGER NOT NULL,
    `uploadedById` INTEGER NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `publicId` VARCHAR(255) NOT NULL,
    `format` VARCHAR(12) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_hire_evidence_reference_key`(`reference`),
    UNIQUE INDEX `event_hire_evidence_publicId_key`(`publicId`),
    INDEX `event_hire_evidence_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_claim` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `bookingId` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'AWAITING_CLIENT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `ownerUserId` INTEGER NOT NULL,
    `description` VARCHAR(2000) NOT NULL,
    `items` JSON NOT NULL,
    `evidence` JSON NOT NULL,
    `requestedAmount` INTEGER NOT NULL,
    `clientResponse` VARCHAR(2000) NULL,
    `clientEvidence` JSON NULL,
    `respondedAt` DATETIME(3) NULL,
    `responseDueAt` DATETIME(3) NOT NULL,
    `award` INTEGER NULL,
    `decisionReason` VARCHAR(2000) NULL,
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_hire_claim_reference_key`(`reference`),
    UNIQUE INDEX `event_hire_claim_bookingId_key`(`bookingId`),
    INDEX `event_hire_claim_status_responseDueAt_idx`(`status`, `responseDueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_transfer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `bookingId` INTEGER NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `payeeUserId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `providerReference` VARCHAR(80) NULL,
    `collectionReference` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_hire_transfer_reference_key`(`reference`),
    UNIQUE INDEX `event_hire_transfer_collectionReference_key`(`collectionReference`),
    INDEX `event_hire_transfer_payeeUserId_status_idx`(`payeeUserId`, `status`),
    UNIQUE INDEX `event_hire_transfer_bookingId_kind_key`(`bookingId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_hire_ledger_entry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookingId` INTEGER NOT NULL,
    `key` VARCHAR(140) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_hire_ledger_entry_key_key`(`key`),
    INDEX `event_hire_ledger_entry_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_hire_booking` ADD CONSTRAINT `event_hire_booking_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `event_hire_request`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_evidence` ADD CONSTRAINT `event_hire_evidence_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `event_hire_booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_claim` ADD CONSTRAINT `event_hire_claim_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `event_hire_booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_transfer` ADD CONSTRAINT `event_hire_transfer_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `event_hire_booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_hire_ledger_entry` ADD CONSTRAINT `event_hire_ledger_entry_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `event_hire_booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
