CREATE TABLE `guest_sms_preference` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `normalizedPhone` VARCHAR(24) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  `consentSource` VARCHAR(40) NULL,
  `consentAt` DATETIME(3) NULL,
  `optedOutAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `guest_sms_preference_ownerId_normalizedPhone_key` (`ownerId`, `normalizedPhone`),
  KEY `guest_sms_preference_ownerId_status_idx` (`ownerId`, `status`),
  CONSTRAINT `guest_sms_preference_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `guest_sms_campaign` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `propertyId` INT NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `kind` VARCHAR(30) NOT NULL,
  `message` VARCHAR(612) NOT NULL,
  `audienceType` VARCHAR(30) NOT NULL,
  `audienceFilter` JSON NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `totalCount` INT NOT NULL DEFAULT 0,
  `eligibleCount` INT NOT NULL DEFAULT 0,
  `sentCount` INT NOT NULL DEFAULT 0,
  `failedCount` INT NOT NULL DEFAULT 0,
  `skippedCount` INT NOT NULL DEFAULT 0,
  `queuedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `guest_sms_campaign_ownerId_createdAt_idx` (`ownerId`, `createdAt`),
  KEY `guest_sms_campaign_propertyId_status_idx` (`propertyId`, `status`),
  CONSTRAINT `guest_sms_campaign_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `guest_sms_campaign_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `guest_sms_annual_quota` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `normalizedPhone` VARCHAR(24) NOT NULL,
  `year` INT NOT NULL,
  `usedCount` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `guest_sms_annual_quota_ownerId_normalizedPhone_year_key` (`ownerId`, `normalizedPhone`, `year`),
  KEY `guest_sms_annual_quota_ownerId_year_idx` (`ownerId`, `year`),
  CONSTRAINT `guest_sms_annual_quota_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `guest_sms_campaign_recipient` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `campaignId` INT NOT NULL,
  `guestProfileId` INT NULL,
  `normalizedPhone` VARCHAR(24) NOT NULL,
  `guestName` VARCHAR(160) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  `skipReason` VARCHAR(40) NULL,
  `provider` VARCHAR(30) NULL,
  `providerMessageId` VARCHAR(160) NULL,
  `errorMessage` VARCHAR(500) NULL,
  `quotaYear` INT NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `guest_sms_campaign_recipient_campaignId_normalizedPhone_key` (`campaignId`, `normalizedPhone`),
  KEY `guest_sms_campaign_recipient_status_createdAt_idx` (`status`, `createdAt`),
  KEY `guest_sms_campaign_recipient_guestProfileId_idx` (`guestProfileId`),
  CONSTRAINT `guest_sms_campaign_recipient_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `guest_sms_campaign` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `guest_sms_campaign_recipient_guestProfileId_fkey` FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
