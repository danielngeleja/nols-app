-- NRMS group master folios.
--
-- Room revenue and incidental revenue remain on their source reservations.
-- These tables only move payment responsibility to the agency/group bill, so
-- revenue reports keep one authoritative source while a single agency payment
-- has a real, auditable landing place.

CREATE TABLE IF NOT EXISTS `nrms_master_folio` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `blockId`          INT NOT NULL,
  `propertyId`       INT NOT NULL,
  `ownerId`          INT NOT NULL,
  `reference`        VARCHAR(40) NOT NULL,
  `billingMode`      VARCHAR(20) NOT NULL,
  `currency`         VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status`           VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `settlementPolicy` VARCHAR(30) NOT NULL DEFAULT 'PAY_BEFORE_DEPARTURE',
  `billToName`       VARCHAR(160) NOT NULL,
  `contactName`      VARCHAR(160) NULL,
  `contactPhone`     VARCHAR(40) NULL,
  `contactEmail`     VARCHAR(160) NULL,
  `settledAt`        DATETIME(3) NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_master_folio_blockId_key` (`blockId`),
  UNIQUE KEY `nrms_master_folio_reference_key` (`reference`),
  KEY `nrms_master_folio_propertyId_status_idx` (`propertyId`, `status`),
  KEY `nrms_master_folio_ownerId_createdAt_idx` (`ownerId`, `createdAt`),

  CONSTRAINT `nrms_master_folio_blockId_fkey`
    FOREIGN KEY (`blockId`) REFERENCES `nrms_group_block` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `nrms_master_folio_item` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `masterFolioId`       INT NOT NULL,
  `reservationId`       INT NOT NULL,
  `reservationChargeId` INT NULL,
  `sourceKey`           VARCHAR(80) NOT NULL,
  `kind`                VARCHAR(20) NOT NULL,
  `description`         VARCHAR(300) NULL,
  `amount`              DECIMAL(12, 2) NOT NULL,
  `currency`            VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `voidedAt`            DATETIME(3) NULL,
  `voidReason`          VARCHAR(300) NULL,
  `createdAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_master_folio_item_reservationChargeId_key` (`reservationChargeId`),
  UNIQUE KEY `nrms_master_folio_item_sourceKey_key` (`sourceKey`),
  KEY `nrms_master_folio_item_masterFolioId_voidedAt_idx` (`masterFolioId`, `voidedAt`),
  KEY `nrms_master_folio_item_reservationId_voidedAt_idx` (`reservationId`, `voidedAt`),

  CONSTRAINT `nrms_master_folio_item_masterFolioId_fkey`
    FOREIGN KEY (`masterFolioId`) REFERENCES `nrms_master_folio` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_item_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_item_reservationChargeId_fkey`
    FOREIGN KEY (`reservationChargeId`) REFERENCES `reservation_charge` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `nrms_master_folio_payment` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `masterFolioId` INT NOT NULL,
  `amount`        DECIMAL(12, 2) NOT NULL,
  `currency`      VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `method`        VARCHAR(30) NOT NULL,
  `reference`     VARCHAR(120) NULL,
  `receiptNumber` VARCHAR(40) NOT NULL,
  `note`          VARCHAR(300) NULL,
  `recordedById`  INT NULL,
  `voidedAt`      DATETIME(3) NULL,
  `voidReason`    VARCHAR(300) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_master_folio_payment_receiptNumber_key` (`receiptNumber`),
  KEY `nrms_master_folio_payment_masterFolioId_createdAt_idx` (`masterFolioId`, `createdAt`),
  KEY `nrms_master_folio_payment_method_idx` (`method`),

  CONSTRAINT `nrms_master_folio_payment_masterFolioId_fkey`
    FOREIGN KEY (`masterFolioId`) REFERENCES `nrms_master_folio` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_payment_recordedById_fkey`
    FOREIGN KEY (`recordedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Forward reconciliation for the rate-plan relation already present on room
-- allocations. Older deployments have the column and FK but not its lookup
-- index, which Prisma's current schema requires.
SET @nrms_rate_plan_index_exists = (
  SELECT COUNT(*)
  FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'reservation_room_allocation'
    AND `INDEX_NAME` = 'reservation_room_allocation_ratePlanId_idx'
);
SET @nrms_rate_plan_index_sql = IF(
  @nrms_rate_plan_index_exists = 0,
  'CREATE INDEX `reservation_room_allocation_ratePlanId_idx` ON `reservation_room_allocation`(`ratePlanId`)',
  'SELECT 1'
);
PREPARE nrms_rate_plan_index_statement FROM @nrms_rate_plan_index_sql;
EXECUTE nrms_rate_plan_index_statement;
DEALLOCATE PREPARE nrms_rate_plan_index_statement;

-- Backfill any SPLIT/MASTER blocks already picked up before this migration.
INSERT INTO `nrms_master_folio` (
  `blockId`, `propertyId`, `ownerId`, `reference`, `billingMode`, `currency`,
  `billToName`, `contactName`, `contactPhone`, `contactEmail`, `createdAt`, `updatedAt`
)
SELECT
  b.`id`, b.`propertyId`, b.`ownerId`, CONCAT('MF-', b.`reference`), b.`billingMode`, b.`currency`,
  COALESCE(NULLIF(b.`agencyName`, ''), NULLIF(b.`contactName`, ''), b.`name`),
  b.`contactName`, b.`contactPhone`, b.`contactEmail`, b.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `nrms_group_block` b
WHERE b.`billingMode` IN ('SPLIT', 'MASTER') AND b.`groupId` IS NOT NULL;

INSERT INTO `nrms_master_folio_item` (
  `masterFolioId`, `reservationId`, `sourceKey`, `kind`, `description`, `amount`, `currency`, `createdAt`, `updatedAt`
)
SELECT
  mf.`id`, r.`id`, CONCAT('ROOM:', r.`id`), 'ROOM', CONCAT('Room stay ', COALESCE(r.`externalRef`, r.`id`)),
  r.`totalAmount`, r.`currency`, r.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `reservation` r
JOIN `nrms_group_block` b ON b.`groupId` = r.`groupId`
JOIN `nrms_master_folio` mf ON mf.`blockId` = b.`id`
WHERE b.`billingMode` IN ('SPLIT', 'MASTER')
  AND r.`status` NOT IN ('CANCELLED', 'NO_SHOW', 'EXPIRED');

INSERT INTO `nrms_master_folio_item` (
  `masterFolioId`, `reservationId`, `reservationChargeId`, `sourceKey`, `kind`, `description`, `amount`, `currency`, `createdAt`, `updatedAt`
)
SELECT
  mf.`id`, c.`reservationId`, c.`id`, CONCAT('CHARGE:', c.`id`), 'EXTRA',
  COALESCE(c.`description`, CONCAT(c.`category`, ' charge')), c.`amount`, c.`currency`, c.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `reservation_charge` c
JOIN `reservation` r ON r.`id` = c.`reservationId`
JOIN `nrms_group_block` b ON b.`groupId` = r.`groupId`
JOIN `nrms_master_folio` mf ON mf.`blockId` = b.`id`
WHERE b.`billingMode` = 'MASTER' AND c.`voidedAt` IS NULL;

UPDATE `nrms_master_folio` mf
SET mf.`status` = 'SETTLED', mf.`settledAt` = CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `nrms_master_folio_item` i
  WHERE i.`masterFolioId` = mf.`id` AND i.`voidedAt` IS NULL AND i.`amount` <> 0
);
