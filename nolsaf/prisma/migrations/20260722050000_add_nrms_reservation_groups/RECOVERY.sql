-- Recovery for the failed 20260722050000_add_nrms_reservation_groups migration.
--
-- Why this is needed: MySQL DDL is not transactional, so statements 1 and 2 of the migration
-- committed before statement 3 failed with errno 1824. The database is left holding a table and a
-- column that the migration history does not consider applied.
--
-- Verified safe on 2026-07-23 before writing this file:
--   nrms_reservation_group  -> 0 rows
--   reservation.groupId     -> 0 non-null values
-- Nothing is dropped that holds data. Re-check both counts before running if time has passed.

-- 1. Remove the partially created objects so the corrected migration can create them cleanly.
ALTER TABLE `reservation` DROP INDEX `reservation_groupId_status_idx`;
ALTER TABLE `reservation` DROP COLUMN `groupId`;
DROP TABLE IF EXISTS `nrms_reservation_group`;

-- 2. After running the above, tell Prisma the migration rolled back, then redeploy:
--
--      npx prisma migrate resolve --rolled-back 20260722050000_add_nrms_reservation_groups --schema=prisma/schema.prisma
--      npx prisma migrate deploy --schema=prisma/schema.prisma
--
-- The migration.sql in this folder has already been corrected: the two foreign keys now reference
-- `user` rather than `User`. This server runs lower_case_table_names=0, so table names are
-- case-sensitive and only the lowercase `user` table exists.
