-- Forward-only expansion of the reception inquiry inbox after the base inbox
-- migration was deployed. Adds explicit automatic acknowledgement timing and
-- property-owned Meta messaging connection state.

ALTER TABLE `nrms_guest_inquiry`
  ADD COLUMN `autoAcknowledgedAt` DATETIME(3) NULL AFTER `assignedToId`;

CREATE TABLE `nrms_messaging_connection` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `externalBusinessId` VARCHAR(191) NULL,
  `externalAccountId` VARCHAR(191) NULL,
  `phoneNumberId` VARCHAR(191) NULL,
  `displayName` VARCHAR(160) NULL,
  `accessTokenEncrypted` TEXT NULL,
  `tokenExpiresAt` DATETIME(3) NULL,
  `scopes` JSON NULL,
  `metadata` JSON NULL,
  `webhookSubscribedAt` DATETIME(3) NULL,
  `lastWebhookAt` DATETIME(3) NULL,
  `lastOutboundAt` DATETIME(3) NULL,
  `lastError` VARCHAR(1000) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_messaging_connection_property_provider_key`(`propertyId`, `provider`),
  UNIQUE INDEX `nrms_messaging_connection_provider_account_key`(`provider`, `externalAccountId`),
  INDEX `nrms_messaging_connection_provider_phoneNumberId_idx`(`provider`, `phoneNumberId`),
  INDEX `nrms_messaging_connection_status_tokenExpiresAt_idx`(`status`, `tokenExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_messaging_connection`
  ADD CONSTRAINT `nrms_messaging_connection_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_messaging_connection_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
