-- NRMS safety controls: temporary freeze state, finance segregation,
-- emergency QR shutdown, worker monitoring, and export access tracking.

ALTER TABLE `user`
  ADD COLUMN `nrmsFinanceRole` VARCHAR(20) NOT NULL DEFAULT 'NONE';

ALTER TABLE `owner_payg_account`
  ADD COLUMN `freezePreviousStatus` VARCHAR(30) NULL,
  ADD COLUMN `frozenAt` DATETIME(3) NULL,
  ADD COLUMN `frozenByAdminId` INTEGER NULL,
  ADD COLUMN `frozenReason` VARCHAR(300) NULL,
  ADD COLUMN `maxStaff` INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN `maxOutlets` INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN `maxMenuItems` INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN `maxOrderPoints` INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN `maxRooms` INTEGER NOT NULL DEFAULT 500;

ALTER TABLE `SystemSetting`
  ADD COLUMN `nrmsQrOrderingEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `nrmsQrOrderingChangedAt` DATETIME(3) NULL,
  ADD COLUMN `nrmsQrOrderingChangedById` INTEGER NULL,
  ADD COLUMN `nrmsQrOrderingReason` VARCHAR(300) NULL;

CREATE TABLE `nrms_worker_health` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `worker` VARCHAR(60) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'STARTING',
  `lastStartedAt` DATETIME(3) NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastFailureAt` DATETIME(3) NULL,
  `lastError` VARCHAR(1000) NULL,
  `runCount` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_worker_health_worker_key` (`worker`),
  INDEX `nrms_worker_health_status_lastSuccessAt_idx` (`status`, `lastSuccessAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_admin_export` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `adminId` INTEGER NOT NULL,
  `propertyId` INTEGER NULL,
  `kind` VARCHAR(40) NOT NULL,
  `purpose` VARCHAR(300) NOT NULL,
  `fromAt` DATETIME(3) NULL,
  `toAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `downloadedAt` DATETIME(3) NULL,
  `ipAddress` VARCHAR(80) NULL,
  `userAgent` VARCHAR(255) NULL,
  `sessionRef` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `nrms_admin_export_adminId_createdAt_idx` (`adminId`, `createdAt`),
  INDEX `nrms_admin_export_propertyId_kind_createdAt_idx` (`propertyId`, `kind`, `createdAt`),
  INDEX `nrms_admin_export_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
