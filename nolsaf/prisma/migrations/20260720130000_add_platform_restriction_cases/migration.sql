-- One durable appeal/reference ledger for every temporary marketplace and
-- NRMS restriction. Business tables remain authoritative for access checks.
CREATE TABLE `platform_restriction_case` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `referenceCode` VARCHAR(48) NOT NULL,
  `activeKey` VARCHAR(80) NULL,
  `scope` VARCHAR(40) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `ownerId` INTEGER NOT NULL,
  `targetId` INTEGER NOT NULL,
  `propertyId` INTEGER NULL,
  `reason` VARCHAR(300) NOT NULL,
  `appliedByAdminId` INTEGER NULL,
  `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedByAdminId` INTEGER NULL,
  `resolvedAt` DATETIME(3) NULL,
  `resolutionNote` VARCHAR(300) NULL,
  `notificationEmailSentAt` DATETIME(3) NULL,
  `notificationEmailError` VARCHAR(500) NULL,
  `resolutionEmailSentAt` DATETIME(3) NULL,
  `resolutionEmailError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `platform_restriction_case_referenceCode_key`(`referenceCode`),
  UNIQUE INDEX `platform_restriction_case_activeKey_key`(`activeKey`),
  INDEX `platform_restriction_case_scope_targetId_status_idx`(`scope`, `targetId`, `status`),
  INDEX `platform_restriction_case_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `platform_restriction_case_propertyId_status_idx`(`propertyId`, `status`),
  INDEX `platform_restriction_case_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve currently active restrictions so every pre-existing freeze also
-- receives a reference after this migration. These records are intentionally
-- marked as migrated and do not claim that an email was sent historically.
INSERT INTO `platform_restriction_case`
  (`referenceCode`, `activeKey`, `scope`, `status`, `ownerId`, `targetId`, `propertyId`, `reason`, `appliedByAdminId`, `appliedAt`, `createdAt`, `updatedAt`)
SELECT CONCAT('NLS-MKT-', `id`, '-LEGACY'), CONCAT('MARKETPLACE_PROPERTY:', `id`), 'MARKETPLACE_PROPERTY', 'OPEN',
  `ownerId`, `id`, `id`,
  'Existing marketplace property suspension migrated into the restriction register.',
  NULL, `updatedAt`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `property`
WHERE `status` = 'SUSPENDED';

INSERT INTO `platform_restriction_case`
  (`referenceCode`, `activeKey`, `scope`, `status`, `ownerId`, `targetId`, `propertyId`, `reason`, `appliedByAdminId`, `appliedAt`, `createdAt`, `updatedAt`)
SELECT CONCAT('NLS-NRA-', `ownerId`, '-LEGACY'), CONCAT('NRMS_ENROLLMENT:', `ownerId`), 'NRMS_ENROLLMENT', 'OPEN',
  `ownerId`, `ownerId`, NULL,
  COALESCE(NULLIF(LEFT(`notes`, 300), ''), 'Existing NRMS enrollment suspension migrated into the restriction register.'),
  NULL, COALESCE(`suspendedAt`, `updatedAt`), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `owner_service_enrollment`
WHERE `status` = 'SUSPENDED';

INSERT INTO `platform_restriction_case`
  (`referenceCode`, `activeKey`, `scope`, `status`, `ownerId`, `targetId`, `propertyId`, `reason`, `appliedByAdminId`, `appliedAt`, `createdAt`, `updatedAt`)
SELECT CONCAT('NLS-NRP-', `propertyId`, '-LEGACY'), CONCAT('NRMS_PROPERTY:', `propertyId`), 'NRMS_PROPERTY', 'OPEN',
  `ownerId`, `propertyId`, `propertyId`,
  COALESCE(NULLIF(`frozenReason`, ''), 'Existing NRMS property freeze migrated into the restriction register.'),
  `frozenByAdminId`, COALESCE(`frozenAt`, `updatedAt`), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `owner_payg_account`
WHERE `status` = 'FROZEN';

INSERT INTO `platform_restriction_case`
  (`referenceCode`, `activeKey`, `scope`, `status`, `ownerId`, `targetId`, `propertyId`, `reason`, `appliedByAdminId`, `appliedAt`, `createdAt`, `updatedAt`)
SELECT CONCAT('NLS-QR-', `id`, '-LEGACY'), CONCAT('NRMS_QR_ORDERING:', `id`), 'NRMS_QR_ORDERING', 'OPEN',
  `ownerId`, `id`, `id`,
  'Existing QR-ordering freeze migrated into the restriction register.',
  NULL, `nrmsQrOrderingFrozenAt`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `property`
WHERE `nrmsQrOrderingFrozenAt` IS NOT NULL;
