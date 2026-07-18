-- NRMS housekeeping: cleanliness state on each physical room plus a task
-- table (turnover after checkout, daily clean, deep clean, maintenance).
-- RoomUnit.housekeepingStatus is the live operational axis, independent of
-- the inventory `status` column. Purely additive: new columns default so no
-- backfill is needed; existing rooms start CLEAN.

ALTER TABLE `room_unit`
  ADD COLUMN `housekeepingStatus` VARCHAR(20) NOT NULL DEFAULT 'CLEAN',
  ADD COLUMN `housekeepingUpdatedAt` DATETIME(3) NULL;

CREATE INDEX `room_unit_propertyId_housekeepingStatus_idx`
  ON `room_unit` (`propertyId`, `housekeepingStatus`);

CREATE TABLE IF NOT EXISTS `nrms_housekeeping_task` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `roomUnitId` INT NOT NULL,
  `reservationId` INT NULL,
  `type` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `priority` VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  `note` VARCHAR(500) NULL,
  `assignedToId` INT NULL,
  `createdById` INT NULL,
  `completedById` INT NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `nrms_housekeeping_task_propertyId_status_createdAt_idx` (`propertyId`, `status`, `createdAt`),
  KEY `nrms_housekeeping_task_roomUnitId_status_idx` (`roomUnitId`, `status`),
  KEY `nrms_housekeeping_task_assignedToId_status_idx` (`assignedToId`, `status`),
  CONSTRAINT `nrms_housekeeping_task_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_housekeeping_task_roomUnitId_fkey`
    FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_housekeeping_task_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_housekeeping_task_assignedToId_fkey`
    FOREIGN KEY (`assignedToId`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_housekeeping_task_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_housekeeping_task_completedById_fkey`
    FOREIGN KEY (`completedById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
