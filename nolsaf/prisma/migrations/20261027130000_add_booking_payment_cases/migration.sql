-- A reported payment without a usable booking code must remain traceable,
-- even if the underlying booking is still NEW after its payment window.
CREATE TABLE `booking_payment_case` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookingId` INTEGER NOT NULL,
  `customerId` INTEGER NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `customerReference` VARCHAR(100) NULL,
  `resolution` VARCHAR(40) NULL,
  `resolvedById` INTEGER NULL,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `booking_payment_case_bookingId_key`(`bookingId`),
  INDEX `booking_payment_case_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `booking_payment_case_customerId_createdAt_idx`(`customerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_payment_case_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `caseId` INTEGER NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `actorId` INTEGER NULL,
  `actorRole` VARCHAR(20) NOT NULL,
  `note` VARCHAR(500) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `booking_payment_case_event_caseId_createdAt_idx`(`caseId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `booking_payment_case`
  ADD CONSTRAINT `booking_payment_case_bookingId_fkey`
  FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `booking_payment_case_event`
  ADD CONSTRAINT `booking_payment_case_event_caseId_fkey`
  FOREIGN KEY (`caseId`) REFERENCES `booking_payment_case`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
