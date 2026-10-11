-- Promotions are off until an admin enters verified store listings and enables them.
-- This table does not control Android Digital Asset Links or Apple AASA.
CREATE TABLE `app_distribution_settings` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `showOnHome` BOOLEAN NOT NULL DEFAULT true,
  `showInFooter` BOOLEAN NOT NULL DEFAULT true,
  `headline` VARCHAR(120) NOT NULL DEFAULT 'Take NoLSAF with you',
  `description` VARCHAR(300) NOT NULL DEFAULT 'Plan and manage your trip in the NoLSAF app.',
  `androidEnabled` BOOLEAN NOT NULL DEFAULT false,
  `androidStoreUrl` VARCHAR(500) NULL,
  `iosEnabled` BOOLEAN NOT NULL DEFAULT false,
  `iosStoreUrl` VARCHAR(500) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `updatedById` INTEGER NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
