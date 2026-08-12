CREATE TABLE `nrms_outlet` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(24) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_outlet_propertyId_code_key` (`propertyId`, `code`),
  INDEX `nrms_outlet_propertyId_type_status_idx` (`propertyId`, `type`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_staff_membership` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `outletId` INTEGER NULL,
  `role` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_staff_membership_propertyId_userId_role_key` (`propertyId`, `userId`, `role`),
  INDEX `nrms_staff_membership_userId_status_idx` (`userId`, `status`),
  INDEX `nrms_staff_membership_outletId_status_idx` (`outletId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_menu_item` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `outletId` INTEGER NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `category` VARCHAR(80) NULL,
  `sku` VARCHAR(50) NULL,
  `price` DECIMAL(12, 2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_menu_item_outletId_sku_key` (`outletId`, `sku`),
  INDEX `nrms_menu_item_outletId_status_category_idx` (`outletId`, `status`, `category`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_outlet_order` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `outletId` INTEGER NOT NULL,
  `reservationId` INTEGER NOT NULL,
  `folioChargeId` INTEGER NULL,
  `orderNumber` VARCHAR(40) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
  `settlementMode` VARCHAR(30) NOT NULL DEFAULT 'ROOM_FOLIO',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `subtotal` DECIMAL(12, 2) NOT NULL,
  `total` DECIMAL(12, 2) NOT NULL,
  `note` VARCHAR(300) NULL,
  `createdById` INTEGER NULL,
  `confirmedById` INTEGER NULL,
  `confirmedAt` DATETIME(3) NULL,
  `preparingAt` DATETIME(3) NULL,
  `servedAt` DATETIME(3) NULL,
  `postedAt` DATETIME(3) NULL,
  `settledAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidReason` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_outlet_order_folioChargeId_key` (`folioChargeId`),
  UNIQUE INDEX `nrms_outlet_order_orderNumber_key` (`orderNumber`),
  INDEX `nrms_outlet_order_propertyId_status_createdAt_idx` (`propertyId`, `status`, `createdAt`),
  INDEX `nrms_outlet_order_outletId_status_createdAt_idx` (`outletId`, `status`, `createdAt`),
  INDEX `nrms_outlet_order_reservationId_createdAt_idx` (`reservationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_outlet_order_item` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `orderId` INTEGER NOT NULL,
  `menuItemId` INTEGER NULL,
  `nameSnapshot` VARCHAR(160) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPrice` DECIMAL(12, 2) NOT NULL,
  `lineTotal` DECIMAL(12, 2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `nrms_outlet_order_item_orderId_idx` (`orderId`),
  INDEX `nrms_outlet_order_item_menuItemId_idx` (`menuItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_outlet` ADD CONSTRAINT `nrms_outlet_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_staff_membership` ADD CONSTRAINT `nrms_staff_membership_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_staff_membership` ADD CONSTRAINT `nrms_staff_membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_staff_membership` ADD CONSTRAINT `nrms_staff_membership_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `nrms_outlet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_menu_item` ADD CONSTRAINT `nrms_menu_item_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `nrms_outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `nrms_outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_folioChargeId_fkey` FOREIGN KEY (`folioChargeId`) REFERENCES `reservation_charge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order_item` ADD CONSTRAINT `nrms_outlet_order_item_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `nrms_outlet_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_outlet_order_item` ADD CONSTRAINT `nrms_outlet_order_item_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `nrms_menu_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
