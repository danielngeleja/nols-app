-- NRMS group blocks (allotments).
--
-- A block holds rooms for a party before any guest names exist. It is the first
-- half of the standard group flow; the rooming list and pickup follow.
--
-- Inventory rule enforced in application code (nrmsAvailability): a block
-- consumes `quantity - pickedUp` rooms per line while its status is HELD or
-- PARTIALLY_PICKED_UP and `cutOffAt` is still in the future. Past cut-off it
-- stops consuming, exactly like an expired HELD reservation, so no worker is
-- needed for inventory to be correct.

CREATE TABLE `nrms_group_block` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `propertyId`   INT NOT NULL,
  `ownerId`      INT NOT NULL,
  `groupId`      INT NULL,
  `reference`    VARCHAR(32) NOT NULL,
  `name`         VARCHAR(160) NOT NULL,
  `agencyName`   VARCHAR(160) NULL,
  `contactName`  VARCHAR(160) NULL,
  `contactPhone` VARCHAR(40) NULL,
  `contactEmail` VARCHAR(160) NULL,
  `checkIn`      DATE NOT NULL,
  `checkOut`     DATE NOT NULL,
  `cutOffAt`     DATETIME(3) NOT NULL,
  `status`       VARCHAR(30) NOT NULL DEFAULT 'HELD',
  `currency`     VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `billingMode`  VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
  `notes`        TEXT NULL,
  `createdById`  INT NULL,
  `releasedAt`   DATETIME(3) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_group_block_reference_key` (`reference`),
  UNIQUE KEY `nrms_group_block_groupId_key` (`groupId`),
  KEY `nrms_group_block_propertyId_status_idx` (`propertyId`, `status`),
  KEY `nrms_group_block_ownerId_createdAt_idx` (`ownerId`, `createdAt`),
  KEY `nrms_group_block_status_cutOffAt_idx` (`status`, `cutOffAt`),

  CONSTRAINT `nrms_group_block_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_group_block_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_group_block_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_group_block_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `nrms_reservation_group` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `nrms_group_block_room` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `blockId`     INT NOT NULL,
  `roomTypeId`  INT NOT NULL,
  `ratePlanId`  INT NULL,
  `quantity`    INT NOT NULL DEFAULT 1,
  `pickedUp`    INT NOT NULL DEFAULT 0,
  `nightlyRate` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `mealPlan`    VARCHAR(20) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_group_block_room_line_key` (`blockId`, `roomTypeId`, `ratePlanId`),
  KEY `nrms_group_block_room_roomTypeId_idx` (`roomTypeId`),

  CONSTRAINT `nrms_group_block_room_blockId_fkey`
    FOREIGN KEY (`blockId`) REFERENCES `nrms_group_block` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_group_block_room_roomTypeId_fkey`
    FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_group_block_room_ratePlanId_fkey`
    FOREIGN KEY (`ratePlanId`) REFERENCES `nrms_rate_plan` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
