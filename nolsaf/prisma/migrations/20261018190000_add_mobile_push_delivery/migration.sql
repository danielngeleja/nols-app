CREATE TABLE `push_device` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `platform` VARCHAR(10) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `push_device_token_key`(`token`),
  INDEX `push_device_userId_active_idx`(`userId`, `active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `push_delivery` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `notificationId` INTEGER NOT NULL,
  `deviceId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ticketId` VARCHAR(100) NULL,
  `sentAt` DATETIME(3) NULL,
  `checkedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `push_delivery_notificationId_deviceId_key`(`notificationId`, `deviceId`),
  INDEX `push_delivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
  INDEX `push_delivery_status_sentAt_idx`(`status`, `sentAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `push_cursor` (
  `id` INTEGER NOT NULL,
  `lastNotificationId` INTEGER NOT NULL DEFAULT 0,
  `activatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `push_device` ADD CONSTRAINT `push_device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `push_delivery` ADD CONSTRAINT `push_delivery_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `push_delivery` ADD CONSTRAINT `push_delivery_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `push_device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing inbox entries predate phone pushes and must not alert after deploy.
INSERT INTO `push_cursor` (`id`, `lastNotificationId`, `activatedAt`, `updatedAt`)
SELECT 1, COALESCE(MAX(`id`), 0), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `notification`;
