-- Contact channels are security factors for payout and account recovery.
-- Record actual replacements separately from initial verification so a newly
-- controlled address/number cannot immediately authorize another sensitive
-- change.

SET @__nolsaf_table := 'user';

SELECT COUNT(*) INTO @__nolsaf_has_email_changed
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @__nolsaf_table
  AND COLUMN_NAME = 'emailChangedAt';

SET @__nolsaf_email_sql := IF(
  @__nolsaf_has_email_changed = 0,
  'ALTER TABLE `user` ADD COLUMN `emailChangedAt` DATETIME(3) NULL',
  'SELECT ''skip: user.emailChangedAt'''
);

PREPARE stmt FROM @__nolsaf_email_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @__nolsaf_has_phone_changed
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @__nolsaf_table
  AND COLUMN_NAME = 'phoneChangedAt';

SET @__nolsaf_phone_sql := IF(
  @__nolsaf_has_phone_changed = 0,
  'ALTER TABLE `user` ADD COLUMN `phoneChangedAt` DATETIME(3) NULL',
  'SELECT ''skip: user.phoneChangedAt'''
);

PREPARE stmt FROM @__nolsaf_phone_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
