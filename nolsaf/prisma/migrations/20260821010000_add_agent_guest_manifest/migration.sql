-- Agent booking guest manifest and incidental-billing responsibility.
-- Inventory remains on the existing reservation; these rows are occupant/KYC
-- declarations linked through the stable agent booking request.

ALTER TABLE `nrms_agent_booking_request`
  ADD COLUMN `incidentalBilling` VARCHAR(30) NULL,
  ADD COLUMN `guestManifestStatus` VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN `guestManifestSubmittedAt` DATETIME(3) NULL,
  ADD COLUMN `guestManifestReviewedAt` DATETIME(3) NULL,
  ADD COLUMN `guestManifestReviewedById` INTEGER NULL,
  ADD COLUMN `guestManifestReviewNote` VARCHAR(1000) NULL;

CREATE TABLE `nrms_agent_booking_guest` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `bookingRequestId` INTEGER NOT NULL,
  `roomNumber` INTEGER NOT NULL,
  `guestType` VARCHAR(10) NOT NULL,
  `isLead` BOOLEAN NOT NULL DEFAULT false,
  `fullName` VARCHAR(160) NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(160) NULL,
  `nationality` VARCHAR(80) NULL,
  `dateOfBirth` DATETIME(3) NULL,
  `documentType` VARCHAR(30) NULL,
  `documentNumber` VARCHAR(100) NULL,
  `documentExpiry` DATETIME(3) NULL,
  `documentKey` VARCHAR(255) NULL,
  `documentMimeType` VARCHAR(100) NULL,
  `documentResourceType` VARCHAR(20) NOT NULL DEFAULT 'image',
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `reviewNote` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `nrms_agent_booking_guest_bookingRequestId_status_idx`(`bookingRequestId`, `status`),
  INDEX `nrms_agent_booking_guest_bookingRequestId_roomNumber_idx`(`bookingRequestId`, `roomNumber`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_agent_booking_guest`
  ADD CONSTRAINT `nrms_agent_booking_guest_bookingRequestId_fkey`
  FOREIGN KEY (`bookingRequestId`) REFERENCES `nrms_agent_booking_request`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
