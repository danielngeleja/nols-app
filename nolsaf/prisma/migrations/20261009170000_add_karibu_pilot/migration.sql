ALTER TABLE `systemsetting` ADD COLUMN `karibuSettings` JSON NULL;

CREATE TABLE `karibu_property_config` (
  `propertyId` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `agreedAt` DATETIME(3) NULL,
  `updatedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`propertyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `karibu_menu_option` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `menuItemId` INTEGER NOT NULL,
  `partnerPrice` DECIMAL(12,2) NOT NULL,
  `alcoholic` BOOLEAN NOT NULL DEFAULT false,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `karibu_menu_option_propertyId_menuItemId_key` (`propertyId`, `menuItemId`),
  INDEX `karibu_menu_option_propertyId_enabled_idx` (`propertyId`, `enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `karibu_gesture` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookingId` INTEGER NOT NULL,
  `propertyId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `reservationId` INTEGER NOT NULL,
  `menuItemId` INTEGER NOT NULL,
  `orderId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
  `contributionEstimate` DECIMAL(12,2) NOT NULL,
  `commissionSnapshot` DECIMAL(12,2) NOT NULL,
  `feeEstimate` DECIMAL(12,2) NOT NULL,
  `attributedCost` DECIMAL(12,2) NOT NULL,
  `budgetSnapshot` DECIMAL(12,2) NOT NULL,
  `partnerPrice` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `issuedById` INTEGER NULL,
  `servedAt` DATETIME(3) NULL,
  `payableStatus` VARCHAR(20) NOT NULL DEFAULT 'NOT_DUE',
  `paidAt` DATETIME(3) NULL,
  `paymentReference` VARCHAR(120) NULL,
  `paidById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `karibu_gesture_bookingId_key` (`bookingId`),
  UNIQUE INDEX `karibu_gesture_orderId_key` (`orderId`),
  INDEX `karibu_gesture_propertyId_status_createdAt_idx` (`propertyId`, `status`, `createdAt`),
  INDEX `karibu_gesture_payableStatus_servedAt_idx` (`payableStatus`, `servedAt`),
  INDEX `karibu_gesture_userId_status_idx` (`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `karibu_gesture` ADD CONSTRAINT `karibu_gesture_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `nrms_outlet_order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
