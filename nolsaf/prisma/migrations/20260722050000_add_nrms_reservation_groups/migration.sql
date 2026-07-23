CREATE TABLE `nrms_reservation_group` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `reference` VARCHAR(32) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `nrms_reservation_group_reference_key` (`reference`),
  INDEX `nrms_reservation_group_propertyId_status_idx` (`propertyId`, `status`),
  INDEX `nrms_reservation_group_ownerId_createdAt_idx` (`ownerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reservation`
  ADD COLUMN `groupId` INTEGER NULL,
  ADD INDEX `reservation_groupId_status_idx` (`groupId`, `status`);

ALTER TABLE `nrms_reservation_group`
  ADD CONSTRAINT `nrms_reservation_group_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_reservation_group_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_reservation_group_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reservation`
  ADD CONSTRAINT `reservation_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `nrms_reservation_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
