-- Forward-only reconciliation for the complete drift confirmed by the
-- 2026-07-29 repository-wide Prisma schema/migration coverage audit.
--
-- The quota columns were deleted from the already-shared
-- 20260720000000_nrms_safety_controls migration. The channel mapping unique
-- key was created with a different column set than the Prisma schema in the
-- same feature commit. Every operation is guarded because staging may retain
-- objects from a partial migration or an earlier db push.

SET @__nolsaf_has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'owner_payg_account'
    AND COLUMN_NAME = 'maxStaff'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `owner_payg_account` ADD COLUMN `maxStaff` INTEGER NOT NULL DEFAULT 100',
  'SELECT ''skip: owner_payg_account.maxStaff'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'owner_payg_account'
    AND COLUMN_NAME = 'maxOutlets'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `owner_payg_account` ADD COLUMN `maxOutlets` INTEGER NOT NULL DEFAULT 50',
  'SELECT ''skip: owner_payg_account.maxOutlets'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'owner_payg_account'
    AND COLUMN_NAME = 'maxMenuItems'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `owner_payg_account` ADD COLUMN `maxMenuItems` INTEGER NOT NULL DEFAULT 500',
  'SELECT ''skip: owner_payg_account.maxMenuItems'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'owner_payg_account'
    AND COLUMN_NAME = 'maxOrderPoints'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `owner_payg_account` ADD COLUMN `maxOrderPoints` INTEGER NOT NULL DEFAULT 1000',
  'SELECT ''skip: owner_payg_account.maxOrderPoints'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'owner_payg_account'
    AND COLUMN_NAME = 'maxRooms'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `owner_payg_account` ADD COLUMN `maxRooms` INTEGER NOT NULL DEFAULT 500',
  'SELECT ''skip: owner_payg_account.maxRooms'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

-- Add the schema-declared three-column identity first. If data violates the
-- intended invariant, this fails closed before the older, stricter key is
-- removed.
SET @__nolsaf_has_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channel_room_mapping'
    AND INDEX_NAME = 'channel_room_mapping_connectionId_roomTypeId_externalId_key'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_index = 0,
  'CREATE UNIQUE INDEX `channel_room_mapping_connectionId_roomTypeId_externalId_key` ON `channel_room_mapping` (`connectionId`, `roomTypeId`, `externalId`)',
  'SELECT ''skip: channel mapping three-column unique index'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;

SET @__nolsaf_has_legacy_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channel_room_mapping'
    AND INDEX_NAME = 'channel_room_mapping_connectionId_externalId_key'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_has_legacy_index > 0,
  'DROP INDEX `channel_room_mapping_connectionId_externalId_key` ON `channel_room_mapping`',
  'SELECT ''skip: legacy channel mapping unique index absent'''
);
PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;
