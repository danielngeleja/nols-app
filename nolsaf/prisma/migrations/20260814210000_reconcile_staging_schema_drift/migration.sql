-- Forward-only reconciliation for the physical drift confirmed on staging on
-- 2026-08-14. The data-safety preflight found no channel-rate duplicates and
-- no transport driver orphans. Existing applied migrations are immutable.

-- Prisma @updatedAt is maintained by the client. These columns were created
-- with database CURRENT_TIMESTAMP defaults (and ON UPDATE behavior), which is
-- a different physical contract. MODIFY is deterministic and safe to repeat.
ALTER TABLE `channel_alert_route`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_calendar_event_map`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_calendar_feed`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_connection`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_outbound_delivery`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_property_mapping`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_provider`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_rate_mapping`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_room_mapping`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `channel_sync_cursor`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_group_block`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_housekeeping_task`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_master_folio`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_master_folio_item`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_master_folio_pro_forma`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_pro_forma_bank_account`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_rooming_list`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `nrms_rooming_list_row`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `payment_method_availability`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
ALTER TABLE `transport_availability`
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- The application upserts rate mappings by (connectionId, externalId). Add
-- that key before removing the three-column key so connectionId continuously
-- has a supporting index for its foreign key. Duplicate data fails closed at
-- CREATE UNIQUE INDEX; the staging preflight verified there are no duplicates.
SET @__nolsaf_has_rate_identity := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channel_rate_mapping'
    AND INDEX_NAME = 'channel_rate_mapping_connectionId_externalId_key'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_rate_identity = 0,
  'CREATE UNIQUE INDEX `channel_rate_mapping_connectionId_externalId_key` ON `channel_rate_mapping` (`connectionId`, `externalId`)',
  'SELECT ''skip: canonical channel-rate identity already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_legacy_rate_identity := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channel_rate_mapping'
    AND INDEX_NAME = 'channel_rate_mapping_connectionId_roomTypeId_externalId_key'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_legacy_rate_identity > 0,
  'DROP INDEX `channel_rate_mapping_connectionId_roomTypeId_externalId_key` ON `channel_rate_mapping`',
  'SELECT ''skip: legacy channel-rate identity absent'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

-- Preserve the existing channel_rate_mapping.connectionId foreign key. The
-- canonical unique key above remains its supporting index after the legacy
-- three-column key is removed.

-- The historical reconciliation was recorded as applied on staging without
-- creating this relationship. Add it only when no semantically equivalent
-- foreign key exists. Orphaned driver ids fail closed; preflight found none.
SET @__nolsaf_has_transport_driver_fk := (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transportbooking'
    AND COLUMN_NAME = 'driverId'
    AND REFERENCED_TABLE_NAME = 'user'
    AND REFERENCED_COLUMN_NAME = 'id'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_transport_driver_fk = 0,
  'ALTER TABLE `transportbooking` ADD CONSTRAINT `transportbooking_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''skip: transportbooking.driverId foreign key already exists'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;
