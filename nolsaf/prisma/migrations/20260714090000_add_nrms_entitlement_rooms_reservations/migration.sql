-- NRMS Phase 1 + Phase 2 core (docs/NOLSAF_ROOMS_MANAGEMENT_SYSTEM.md)
-- Entitlement, normalized room inventory, external reservations, guests,
-- payments. Purely additive: no existing table is dropped or rewritten.
-- PAYG billing tables arrive with Phase 3.

-- ---------------------------------------------------------
-- Entitlement (doc section 5)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `service_plan` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `config` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `service_plan_code_key` (`code`),
  KEY `service_plan_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `owner_service_enrollment` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ownerId` INT NOT NULL,
  `planId` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `trialStartsAt` DATETIME(3) NULL,
  `trialEndsAt` DATETIME(3) NULL,
  `activatedAt` DATETIME(3) NULL,
  `suspendedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` VARCHAR(300) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `owner_service_enrollment_ownerId_planId_key` (`ownerId`, `planId`),
  KEY `owner_service_enrollment_status_idx` (`status`),
  KEY `owner_service_enrollment_planId_status_idx` (`planId`, `status`),
  CONSTRAINT `owner_service_enrollment_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `owner_service_enrollment_planId_fkey`
    FOREIGN KEY (`planId`) REFERENCES `service_plan` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- Normalized room inventory (doc sections 7.1, 9.2)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `room_type` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `capacityAdults` INT NOT NULL DEFAULT 2,
  `capacityChildren` INT NOT NULL DEFAULT 0,
  `bedSetup` VARCHAR(200) NULL,
  `baseRate` DECIMAL(12, 2) NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `images` JSON NULL,
  `amenities` JSON NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `sortOrder` INT NOT NULL DEFAULT 0,
  `sourceSpecKey` VARCHAR(120) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `room_type_propertyId_name_key` (`propertyId`, `name`),
  KEY `room_type_propertyId_status_idx` (`propertyId`, `status`),
  CONSTRAINT `room_type_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `roomTypeId` INT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `floor` INT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `notes` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `room_unit_propertyId_code_key` (`propertyId`, `code`),
  KEY `room_unit_roomTypeId_status_idx` (`roomTypeId`, `status`),
  KEY `room_unit_propertyId_status_idx` (`propertyId`, `status`),
  CONSTRAINT `room_unit_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `room_unit_roomTypeId_fkey`
    FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_status_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `roomUnitId` INT NOT NULL,
  `fromStatus` VARCHAR(20) NOT NULL,
  `toStatus` VARCHAR(20) NOT NULL,
  `reason` VARCHAR(300) NULL,
  `changedById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `room_unit_status_history_roomUnitId_createdAt_idx` (`roomUnitId`, `createdAt`),
  CONSTRAINT `room_unit_status_history_roomUnitId_fkey`
    FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `room_unit_status_history_changedById_fkey`
    FOREIGN KEY (`changedById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- Guests (doc section 7.6)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `guest_profile` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `ownerId` INT NOT NULL,
  `fullName` VARCHAR(160) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(160) NULL,
  `nationality` VARCHAR(80) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `guest_profile_propertyId_phone_idx` (`propertyId`, `phone`),
  KEY `guest_profile_propertyId_fullName_idx` (`propertyId`, `fullName`),
  KEY `guest_profile_ownerId_idx` (`ownerId`),
  CONSTRAINT `guest_profile_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `guest_profile_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- Reservations and stays (doc sections 6.3, 6.4, 9.3)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS `reservation` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `ownerId` INT NOT NULL,
  `guestProfileId` INT NULL,
  `bookingId` INT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'WALK_IN',
  `attribution` VARCHAR(30) NULL,
  `externalRef` VARCHAR(120) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `holdExpiresAt` DATETIME(3) NULL,
  `checkIn` DATETIME(3) NOT NULL,
  `checkOut` DATETIME(3) NOT NULL,
  `adults` INT NOT NULL DEFAULT 1,
  `children` INT NOT NULL DEFAULT 0,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `roomRate` DECIMAL(12, 2) NULL,
  `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `depositAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `amountPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `confirmedAt` DATETIME(3) NULL,
  `checkedInAt` DATETIME(3) NULL,
  `checkedOutAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelReason` VARCHAR(300) NULL,
  `noShowAt` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservation_bookingId_key` (`bookingId`),
  KEY `reservation_propertyId_checkIn_checkOut_idx` (`propertyId`, `checkIn`, `checkOut`),
  KEY `reservation_propertyId_status_idx` (`propertyId`, `status`),
  KEY `reservation_ownerId_status_idx` (`ownerId`, `status`),
  KEY `reservation_guestProfileId_idx` (`guestProfileId`),
  KEY `reservation_source_idx` (`source`),
  KEY `reservation_status_holdExpiresAt_idx` (`status`, `holdExpiresAt`),
  CONSTRAINT `reservation_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_guestProfileId_fkey`
    FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reservation_bookingId_fkey`
    FOREIGN KEY (`bookingId`) REFERENCES `booking` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reservation_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_room_allocation` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservationId` INT NOT NULL,
  `roomTypeId` INT NOT NULL,
  `roomUnitId` INT NULL,
  `startDate` DATETIME(3) NOT NULL,
  `endDate` DATETIME(3) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `reservation_room_allocation_reservationId_idx` (`reservationId`),
  KEY `rra_unit_status_start_end_idx` (`roomUnitId`, `status`, `startDate`, `endDate`),
  KEY `rra_type_status_start_end_idx` (`roomTypeId`, `status`, `startDate`, `endDate`),
  CONSTRAINT `reservation_room_allocation_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_room_allocation_roomTypeId_fkey`
    FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_room_allocation_roomUnitId_fkey`
    FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservationId` INT NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `data` JSON NULL,
  `actorId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `reservation_event_reservationId_createdAt_idx` (`reservationId`, `createdAt`),
  KEY `reservation_event_type_idx` (`type`),
  CONSTRAINT `reservation_event_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_event_actorId_fkey`
    FOREIGN KEY (`actorId`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_payment_record` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservationId` INT NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `method` VARCHAR(30) NOT NULL,
  `reference` VARCHAR(120) NULL,
  `note` VARCHAR(300) NULL,
  `recordedById` INT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidReason` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `external_payment_record_reservationId_createdAt_idx` (`reservationId`, `createdAt`),
  KEY `external_payment_record_method_idx` (`method`),
  CONSTRAINT `external_payment_record_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `external_payment_record_recordedById_fkey`
    FOREIGN KEY (`recordedById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- Existing tables: additive columns only (doc sections 8.2, 10.2)
-- ---------------------------------------------------------

ALTER TABLE `property`
  ADD COLUMN `nrmsActivatedAt` DATETIME(3) NULL;

ALTER TABLE `propertyavailabilityblock`
  ADD COLUMN `kind` VARCHAR(30) NULL,
  ADD COLUMN `roomUnitId` INT NULL,
  ADD COLUMN `migratedReservationId` INT NULL;

ALTER TABLE `propertyavailabilityblock`
  ADD UNIQUE KEY `propertyavailabilityblock_migratedReservationId_key` (`migratedReservationId`),
  ADD KEY `propertyavailabilityblock_kind_idx` (`kind`),
  ADD KEY `propertyavailabilityblock_roomUnitId_startDate_endDate_idx` (`roomUnitId`, `startDate`, `endDate`),
  ADD CONSTRAINT `propertyavailabilityblock_roomUnitId_fkey`
    FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `propertyavailabilityblock_migratedReservationId_fkey`
    FOREIGN KEY (`migratedReservationId`) REFERENCES `reservation` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------
-- Seed: the NRMS PAYG plan (doc section 8.7). Commercial numbers stay in
-- versioned policy config, never hard-coded in application code.
-- ---------------------------------------------------------

INSERT INTO `service_plan` (`code`, `name`, `description`, `status`, `config`)
VALUES (
  'NRMS_PAYG',
  'NoLSAF NRMS PAYG',
  'Usage-based rooms management subscription. No setup fee, no monthly base fee. Charges accrue per completed external occupied room-night under the active usage policy.',
  'ACTIVE',
  JSON_OBJECT(
    'policyVersion', 'NRMS-2026-07-BASELINE',
    'trialDays', 45,
    'currency', 'TZS',
    'roomNightUnitPrice', 500,
    'unpaidUsageLimit', 50000,
    'billableMilestone', 'EXTERNAL_CHECKOUT'
  )
)
ON DUPLICATE KEY UPDATE `code` = `code`;
