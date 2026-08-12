-- NRMS Phase 0: provider-neutral OTA/channel foundation.
-- Additive only. Provider connectors are implemented after this boundary.

CREATE TABLE IF NOT EXISTS `channel_provider` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_provider_code_key` (`code`),
  KEY `channel_provider_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `channel_provider` (`code`, `name`, `status`)
VALUES
  ('BOOKING_COM', 'Booking.com', 'ACTIVE'),
  ('AIRBNB', 'Airbnb', 'ACTIVE'),
  ('EXPEDIA', 'Expedia Group', 'ACTIVE');

CREATE TABLE IF NOT EXISTS `channel_connection` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  `providerId` INT NOT NULL,
  `connectionType` VARCHAR(20) NOT NULL DEFAULT 'API',
  `status` VARCHAR(20) NOT NULL DEFAULT 'DISCONNECTED',
  `trustTier` VARCHAR(20) NOT NULL DEFAULT 'UNTRUSTED',
  `externalPropertyId` VARCHAR(160) NULL,
  `lastInboundAt` DATETIME(3) NULL,
  `lastOutboundAt` DATETIME(3) NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastFailureAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(80) NULL,
  `lastErrorMessage` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_connection_propertyId_providerId_key` (`propertyId`, `providerId`),
  KEY `channel_connection_propertyId_status_idx` (`propertyId`, `status`),
  KEY `channel_connection_providerId_status_idx` (`providerId`, `status`),
  KEY `channel_connection_status_lastSuccessAt_idx` (`status`, `lastSuccessAt`),
  CONSTRAINT `channel_connection_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_connection_providerId_fkey`
    FOREIGN KEY (`providerId`) REFERENCES `channel_provider` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_property_mapping` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `externalId` VARCHAR(160) NOT NULL,
  `externalName` VARCHAR(200) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'UNMAPPED',
  `mappingVersion` INT NOT NULL DEFAULT 1,
  `metadata` JSON NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_property_mapping_connectionId_key` (`connectionId`),
  KEY `channel_property_mapping_externalId_idx` (`externalId`),
  KEY `channel_property_mapping_status_idx` (`status`),
  CONSTRAINT `channel_property_mapping_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_property_mapping_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_room_mapping` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `roomTypeId` INT NOT NULL,
  `externalId` VARCHAR(160) NOT NULL,
  `externalName` VARCHAR(200) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'UNMAPPED',
  `mappingVersion` INT NOT NULL DEFAULT 1,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_room_mapping_connectionId_roomTypeId_key` (`connectionId`, `roomTypeId`),
  UNIQUE KEY `channel_room_mapping_connectionId_externalId_key` (`connectionId`, `externalId`),
  KEY `channel_room_mapping_roomTypeId_status_idx` (`roomTypeId`, `status`),
  CONSTRAINT `channel_room_mapping_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_room_mapping_roomTypeId_fkey`
    FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_rate_mapping` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `roomTypeId` INT NULL,
  `externalId` VARCHAR(160) NOT NULL,
  `externalName` VARCHAR(200) NULL,
  `currency` VARCHAR(3) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'UNMAPPED',
  `mappingVersion` INT NOT NULL DEFAULT 1,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_rate_mapping_connectionId_externalId_key` (`connectionId`, `externalId`),
  KEY `channel_rate_mapping_connectionId_roomTypeId_status_idx` (`connectionId`, `roomTypeId`, `status`),
  CONSTRAINT `channel_rate_mapping_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_rate_mapping_roomTypeId_fkey`
    FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_credential_version` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `version` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'STAGED',
  `encryptedData` TEXT NOT NULL,
  `activatedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_credential_version_connectionId_version_key` (`connectionId`, `version`),
  KEY `channel_credential_version_connectionId_status_idx` (`connectionId`, `status`),
  CONSTRAINT `channel_credential_version_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_credential_version_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_sync_cursor` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `scope` VARCHAR(60) NOT NULL,
  `cursor` TEXT NULL,
  `lastSyncedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_sync_cursor_connectionId_scope_key` (`connectionId`, `scope`),
  KEY `channel_sync_cursor_scope_lastSyncedAt_idx` (`scope`, `lastSyncedAt`),
  CONSTRAINT `channel_sync_cursor_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_inbound_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `providerEventId` VARCHAR(200) NOT NULL,
  `idempotencyKey` VARCHAR(200) NOT NULL,
  `eventType` VARCHAR(80) NOT NULL,
  `payloadHash` VARCHAR(128) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  `reservationId` INT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,
  `errorMessage` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_inbound_event_connectionId_providerEventId_key` (`connectionId`, `providerEventId`),
  UNIQUE KEY `channel_inbound_event_connectionId_idempotencyKey_key` (`connectionId`, `idempotencyKey`),
  KEY `channel_inbound_event_connectionId_status_receivedAt_idx` (`connectionId`, `status`, `receivedAt`),
  KEY `channel_inbound_event_reservationId_idx` (`reservationId`),
  CONSTRAINT `channel_inbound_event_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_inbound_event_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_outbound_delivery` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `idempotencyKey` VARCHAR(200) NOT NULL,
  `eventType` VARCHAR(80) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attemptCount` INT NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NULL,
  `lastAttemptAt` DATETIME(3) NULL,
  `acknowledgedAt` DATETIME(3) NULL,
  `reservationId` INT NULL,
  `lastError` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_outbound_delivery_connectionId_idempotencyKey_key` (`connectionId`, `idempotencyKey`),
  KEY `channel_outbound_delivery_connectionId_status_nextAttemptAt_idx` (`connectionId`, `status`, `nextAttemptAt`),
  KEY `channel_outbound_delivery_reservationId_idx` (`reservationId`),
  CONSTRAINT `channel_outbound_delivery_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_outbound_delivery_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_sync_run` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `kind` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `itemCount` INT NOT NULL DEFAULT 0,
  `successCount` INT NOT NULL DEFAULT 0,
  `failureCount` INT NOT NULL DEFAULT 0,
  `details` JSON NULL,
  `errorMessage` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  KEY `channel_sync_run_connectionId_startedAt_idx` (`connectionId`, `startedAt`),
  KEY `channel_sync_run_status_startedAt_idx` (`status`, `startedAt`),
  CONSTRAINT `channel_sync_run_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_reconciliation_issue` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `severity` VARCHAR(20) NOT NULL DEFAULT 'WARNING',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `externalRef` VARCHAR(200) NULL,
  `internalRef` VARCHAR(200) NULL,
  `details` JSON NULL,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedAt` DATETIME(3) NULL,
  `resolvedById` INT NULL,
  PRIMARY KEY (`id`),
  KEY `channel_reconciliation_issue_connectionId_status_severity_idx` (`connectionId`, `status`, `severity`),
  KEY `channel_reconciliation_issue_kind_status_idx` (`kind`, `status`),
  KEY `channel_reconciliation_issue_externalRef_idx` (`externalRef`),
  KEY `channel_reconciliation_issue_internalRef_idx` (`internalRef`),
  CONSTRAINT `channel_reconciliation_issue_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_reconciliation_issue_resolvedById_fkey`
    FOREIGN KEY (`resolvedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_calendar_feed` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `direction` VARCHAR(10) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `encryptedUrl` TEXT NULL,
  `urlFingerprint` VARCHAR(128) NULL,
  `lastPolledAt` DATETIME(3) NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `nextPollAt` DATETIME(3) NULL,
  `lastError` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `channel_calendar_feed_connectionId_direction_status_idx` (`connectionId`, `direction`, `status`),
  KEY `channel_calendar_feed_status_nextPollAt_idx` (`status`, `nextPollAt`),
  CONSTRAINT `channel_calendar_feed_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `channel_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_calendar_event_map` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `feedId` INT NOT NULL,
  `externalEventId` VARCHAR(200) NOT NULL,
  `eventHash` VARCHAR(128) NOT NULL,
  `reservationId` INT NULL,
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `channel_calendar_event_map_feedId_externalEventId_key` (`feedId`, `externalEventId`),
  KEY `channel_calendar_event_map_reservationId_idx` (`reservationId`),
  KEY `channel_calendar_event_map_feedId_lastSeenAt_idx` (`feedId`, `lastSeenAt`),
  CONSTRAINT `channel_calendar_event_map_feedId_fkey`
    FOREIGN KEY (`feedId`) REFERENCES `channel_calendar_feed` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `channel_calendar_event_map_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
