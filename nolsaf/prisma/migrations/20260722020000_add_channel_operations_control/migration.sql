-- NRMS Phase 1B: durable channel SLO evidence, routed incidents,
-- governed emergency stop-sell, and credential validation metadata.

ALTER TABLE `channel_credential_version`
  ADD COLUMN `validationStatus` VARCHAR(20) NOT NULL DEFAULT 'UNTESTED',
  ADD COLUMN `validatedAt` DATETIME(3) NULL,
  ADD COLUMN `validationError` VARCHAR(500) NULL,
  ADD COLUMN `stagedExpiresAt` DATETIME(3) NULL;

CREATE TABLE `channel_operational_snapshot` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `healthState` VARCHAR(20) NOT NULL,
  `lagMinutes` INT NULL,
  `pendingDeliveries` INT NOT NULL DEFAULT 0,
  `sendingDeliveries` INT NOT NULL DEFAULT 0,
  `failedDeliveries` INT NOT NULL DEFAULT 0,
  `deadLetters` INT NOT NULL DEFAULT 0,
  `openIssues` INT NOT NULL DEFAULT 0,
  `criticalIssues` INT NOT NULL DEFAULT 0,
  `deliverySuccessBps` INT NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `channel_operational_snapshot_connectionId_capturedAt_idx` (`connectionId`, `capturedAt`),
  KEY `channel_operational_snapshot_healthState_capturedAt_idx` (`healthState`, `capturedAt`),
  CONSTRAINT `channel_operational_snapshot_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `channel_alert_route` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `adminsEnabled` BOOLEAN NOT NULL DEFAULT true,
  `ownerEnabled` BOOLEAN NOT NULL DEFAULT true,
  `minimumSeverity` VARCHAR(20) NOT NULL DEFAULT 'ATTENTION',
  `cooldownMinutes` INT NOT NULL DEFAULT 30,
  `updatedById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_alert_route_connectionId_key` (`connectionId`),
  KEY `channel_alert_route_minimumSeverity_idx` (`minimumSeverity`),
  CONSTRAINT `channel_alert_route_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `channel_operational_alert` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `activeKey` VARCHAR(160) NULL,
  `kind` VARCHAR(60) NOT NULL,
  `severity` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `occurrenceCount` INT NOT NULL DEFAULT 1,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastNotifiedAt` DATETIME(3) NULL,
  `resolvedAt` DATETIME(3) NULL,
  `details` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_operational_alert_activeKey_key` (`activeKey`),
  KEY `channel_operational_alert_connectionId_status_severity_idx` (`connectionId`, `status`, `severity`),
  KEY `channel_operational_alert_status_lastSeenAt_idx` (`status`, `lastSeenAt`),
  CONSTRAINT `channel_operational_alert_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `channel_stop_sell_request` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL',
  `fromDate` DATETIME(3) NOT NULL,
  `toDate` DATETIME(3) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `requestedById` INT NOT NULL,
  `approvedById` INT NULL,
  `rejectedById` INT NULL,
  `decisionReason` VARCHAR(500) NULL,
  `deliveryId` INT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decidedAt` DATETIME(3) NULL,
  `providerConfirmedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `failureMessage` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  KEY `channel_stop_sell_request_connectionId_requestedAt_idx` (`connectionId`, `requestedAt`),
  KEY `channel_stop_sell_request_status_requestedAt_idx` (`status`, `requestedAt`),
  KEY `channel_stop_sell_request_deliveryId_idx` (`deliveryId`),
  CONSTRAINT `channel_stop_sell_request_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
