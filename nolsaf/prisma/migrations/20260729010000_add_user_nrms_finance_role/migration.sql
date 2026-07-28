-- The NRMS finance role was added to the Prisma User model without a matching
-- production migration. Authentication selects this field for every protected
-- request, so a missing column makes a successful login immediately become 401.
SET @__nolsaf_has_column := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user'
    AND COLUMN_NAME = 'nrmsFinanceRole'
);

SET @__nolsaf_sql := IF(
  @__nolsaf_has_column = 0,
  'ALTER TABLE `user` ADD COLUMN `nrmsFinanceRole` VARCHAR(20) NOT NULL DEFAULT ''NONE''',
  'SELECT ''skip: user.nrmsFinanceRole'''
);

PREPARE __nolsaf_stmt FROM @__nolsaf_sql;
EXECUTE __nolsaf_stmt;
DEALLOCATE PREPARE __nolsaf_stmt;
