SET @__nolsaf_table := 'user';

SELECT COUNT(*) INTO @__nolsaf_has_column
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @__nolsaf_table
  AND COLUMN_NAME = 'tokensValidAfter';

SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `user` ADD COLUMN `tokensValidAfter` DATETIME(3) NULL',
  'SELECT ''skip: user.tokensValidAfter'''
);

PREPARE stmt FROM @__nolsaf_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
