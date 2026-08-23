-- Attributable property sharing.
--
-- `savedproperty.sharedAt` records only that a share happened: no token, no
-- recipient, no way to connect a share to a registration or a booking. This
-- table carries the token that makes a share traceable end to end.
--
-- Expand-only. Nothing existing is altered or backfilled: rows that predate
-- this table keep their `sharedAt` timestamp and are reported as legacy,
-- unattributable shares rather than as shares that performed badly.
--
-- Engagement is stored as counters on this row, not as one row per open. A row
-- per open would retain visitor IP and user agent for people who never
-- registered, which is personal data held for no reporting benefit.

CREATE TABLE `property_share` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(24) NOT NULL,
  `sharerId` INTEGER NOT NULL,
  `propertyId` INTEGER NOT NULL,
  `channel` VARCHAR(20) NULL,
  `openCount` INTEGER NOT NULL DEFAULT 0,
  `firstOpenedAt` DATETIME(3) NULL,
  `lastOpenedAt` DATETIME(3) NULL,
  `registeredUserId` INTEGER NULL,
  `registeredAt` DATETIME(3) NULL,
  `bookingId` INTEGER NULL,
  `convertedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `property_share_token_key`(`token`),
  INDEX `property_share_sharerId_createdAt_idx`(`sharerId`, `createdAt`),
  INDEX `property_share_propertyId_idx`(`propertyId`),
  INDEX `property_share_registeredUserId_idx`(`registeredUserId`),
  INDEX `property_share_bookingId_idx`(`bookingId`),
  INDEX `property_share_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Deleting the sharer or the property removes the share: neither can be
-- reported on once its subject is gone.
ALTER TABLE `property_share`
  ADD CONSTRAINT `property_share_sharerId_fkey`
  FOREIGN KEY (`sharerId`) REFERENCES `User`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `property_share`
  ADD CONSTRAINT `property_share_propertyId_fkey`
  FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The attributed registration and booking are references, not owners. If either
-- is removed the share row survives with its engagement history intact.
ALTER TABLE `property_share`
  ADD CONSTRAINT `property_share_registeredUserId_fkey`
  FOREIGN KEY (`registeredUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `property_share`
  ADD CONSTRAINT `property_share_bookingId_fkey`
  FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
