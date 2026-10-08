-- Owner requests to get a guest's check-in code back to the guest, and how
-- NoLSAF handled them. Runs on MySQL 8 (staging) and MariaDB 11.8 (prod).
CREATE TABLE `guest_code_request` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookingId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'SENT',
  `channel` VARCHAR(10) NULL,
  `destinationMasked` VARCHAR(40) NULL,
  `reason` VARCHAR(255) NULL,
  `resolution` VARCHAR(20) NULL,
  `adminNote` VARCHAR(500) NULL,
  `resolvedById` INTEGER NULL,
  `resolvedAt` DATETIME(3) NULL,
  `remindedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `guest_code_request_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `guest_code_request_bookingId_idx`(`bookingId`),
  INDEX `guest_code_request_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `guest_code_request`
  ADD CONSTRAINT `guest_code_request_bookingId_fkey`
  FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
