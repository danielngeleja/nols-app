ALTER TABLE `nrms_rate_restriction`
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `createdById` INTEGER NULL,
  ADD COLUMN `updatedById` INTEGER NULL,
  ADD COLUMN `removedAt` DATETIME(3) NULL;

CREATE TABLE `nrms_rate_restriction_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `restrictionId` INTEGER NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `actorId` INTEGER NULL,
  `fromVersion` INTEGER NULL,
  `toVersion` INTEGER NOT NULL,
  `data` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `nrms_rate_restriction_event_restrictionId_createdAt_idx` (`restrictionId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `nrms_rate_restriction_event_restrictionId_fkey`
    FOREIGN KEY (`restrictionId`) REFERENCES `nrms_rate_restriction` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
