SET @__nolsaf_table := 'systemsetting';

SELECT COUNT(*) INTO @__nolsaf_has_column
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @__nolsaf_table
  AND COLUMN_NAME = 'sessionMaxMinutesAgent';

SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `systemsetting` ADD COLUMN `sessionMaxMinutesAgent` INT NULL',
  'SELECT ''skip: systemsetting.sessionMaxMinutesAgent'''
);

PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
