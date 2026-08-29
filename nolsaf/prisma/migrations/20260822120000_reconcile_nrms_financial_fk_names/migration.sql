-- Reconcile the shortened foreign-key names created by the shared
-- 20260717090000 migration with the canonical names Prisma derives from the
-- current schema. Foreign-key semantics are unchanged.
--
-- Every operation is guarded so this migration is safe for both known states:
-- staging already has the canonical names, while the restored production
-- snapshot retained the shortened names. Existing applied migrations remain
-- immutable.

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_transaction_propertyId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_tx_propertyId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_propertyId_fkey`',
    'SELECT ''skip: nrms_ledger_transaction_propertyId_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_propertyId_fkey`, ADD CONSTRAINT `nrms_ledger_transaction_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
    'ALTER TABLE `nrms_ledger_transaction` ADD CONSTRAINT `nrms_ledger_transaction_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_transaction_businessDayId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_tx_businessDayId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_businessDayId_fkey`',
    'SELECT ''skip: nrms_ledger_transaction_businessDayId_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_businessDayId_fkey`, ADD CONSTRAINT `nrms_ledger_transaction_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'ALTER TABLE `nrms_ledger_transaction` ADD CONSTRAINT `nrms_ledger_transaction_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_transaction_nightAuditRunId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_ledger_transaction'
    AND CONSTRAINT_NAME = 'nrms_ledger_tx_nightAuditRunId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_nightAuditRunId_fkey`',
    'SELECT ''skip: nrms_ledger_transaction_nightAuditRunId_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_ledger_transaction` DROP FOREIGN KEY `nrms_ledger_tx_nightAuditRunId_fkey`, ADD CONSTRAINT `nrms_ledger_transaction_nightAuditRunId_fkey` FOREIGN KEY (`nightAuditRunId`) REFERENCES `nrms_night_audit_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'ALTER TABLE `nrms_ledger_transaction` ADD CONSTRAINT `nrms_ledger_transaction_nightAuditRunId_fkey` FOREIGN KEY (`nightAuditRunId`) REFERENCES `nrms_night_audit_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_run_propertyId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_propertyId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_propertyId_fkey`',
    'SELECT ''skip: nrms_night_audit_run_propertyId_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_propertyId_fkey`, ADD CONSTRAINT `nrms_night_audit_run_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
    'ALTER TABLE `nrms_night_audit_run` ADD CONSTRAINT `nrms_night_audit_run_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_run_businessDayId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_businessDayId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_businessDayId_fkey`',
    'SELECT ''skip: nrms_night_audit_run_businessDayId_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_businessDayId_fkey`, ADD CONSTRAINT `nrms_night_audit_run_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'ALTER TABLE `nrms_night_audit_run` ADD CONSTRAINT `nrms_night_audit_run_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_run_startedById_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_startedById_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_startedById_fkey`',
    'SELECT ''skip: nrms_night_audit_run_startedById_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_startedById_fkey`, ADD CONSTRAINT `nrms_night_audit_run_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'ALTER TABLE `nrms_night_audit_run` ADD CONSTRAINT `nrms_night_audit_run_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @__nolsaf_canonical_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_run_closedById_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_legacy_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_night_audit_run'
    AND CONSTRAINT_NAME = 'nrms_night_audit_closedById_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @__nolsaf_sql := IF(
  @__nolsaf_canonical_exists > 0,
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_closedById_fkey`',
    'SELECT ''skip: nrms_night_audit_run_closedById_fkey already canonical'''
  ),
  IF(
    @__nolsaf_legacy_exists > 0,
    'ALTER TABLE `nrms_night_audit_run` DROP FOREIGN KEY `nrms_night_audit_closedById_fkey`, ADD CONSTRAINT `nrms_night_audit_run_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'ALTER TABLE `nrms_night_audit_run` ADD CONSTRAINT `nrms_night_audit_run_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
