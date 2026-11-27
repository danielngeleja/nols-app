-- Agency Desk quote and pay request, step 1 (docs/SALES_AGENCY_QUOTES_STRATEGY.md):
-- quotes, their 1 to 3 options, and demand signals for needs nothing matched.
-- Prepared 2026-11-27. NOT APPLIED. Apply only with Daniel's approval.
-- Three new tables, one internal FK (option -> quote), no change to existing
-- tables: runs on both MySQL 8 (staging) and MariaDB 11.8 (prod).

CREATE TABLE `sales_quote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicRef` VARCHAR(16) NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `clientAccountId` INTEGER NULL,
    `clientName` VARCHAR(160) NOT NULL,
    `clientPhone` VARCHAR(40) NOT NULL,
    `clientPhoneNormalized` VARCHAR(40) NOT NULL,
    `clientEmail` VARCHAR(190) NULL,
    `note` VARCHAR(500) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'SENT',
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `viewedAt` DATETIME(3) NULL,
    `payingAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `chosenOptionId` INTEGER NULL,
    `bookingId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `sales_quote_publicRef_key`(`publicRef`),
    UNIQUE INDEX `sales_quote_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `sales_quote_bookingId_key`(`bookingId`),
    INDEX `sales_quote_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_quote_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `sales_quote_clientPhoneNormalized_idx`(`clientPhoneNormalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_quote_option` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quoteId` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `roomCode` VARCHAR(60) NULL,
    `rooms` INTEGER NOT NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `adults` INTEGER NOT NULL,
    `children` INTEGER NOT NULL DEFAULT 0,
    `nights` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `totalPrice` DECIMAL(14, 2) NOT NULL,
    `priceSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `sales_quote_option_quoteId_position_key`(`quoteId`, `position`),
    INDEX `sales_quote_option_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_demand_signal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `regionId` INTEGER NULL,
    `region` VARCHAR(80) NULL,
    `district` VARCHAR(80) NULL,
    `area` VARCHAR(120) NULL,
    `people` INTEGER NOT NULL,
    `rooms` INTEGER NULL,
    `dayUse` BOOLEAN NOT NULL DEFAULT false,
    `features` JSON NULL,
    `wholePlace` BOOLEAN NOT NULL DEFAULT false,
    `checkIn` DATETIME(3) NULL,
    `checkOut` DATETIME(3) NULL,
    `budgetTzs` INTEGER NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `sales_demand_signal_createdAt_idx`(`createdAt`),
    INDEX `sales_demand_signal_regionId_createdAt_idx`(`regionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales_quote_option` ADD CONSTRAINT `sales_quote_option_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `sales_quote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
