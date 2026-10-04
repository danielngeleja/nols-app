CREATE TABLE `trip_share` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(48) NOT NULL,
  `userId` INTEGER NOT NULL,
  `serviceKind` VARCHAR(20) NOT NULL,
  `serviceId` INTEGER NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `openCount` INTEGER NOT NULL DEFAULT 0,
  `firstOpenedAt` DATETIME(3) NULL,
  `lastOpenedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `trip_share_token_key`(`token`),
  INDEX `trip_share_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `trip_share_serviceKind_serviceId_idx`(`serviceKind`, `serviceId`),
  INDEX `trip_share_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `trip_share_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
