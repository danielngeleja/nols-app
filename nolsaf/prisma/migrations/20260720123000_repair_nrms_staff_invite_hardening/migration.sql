-- Repair databases where 20260720120000_harden_nrms_staff_invites was
-- recorded as applied even though its DDL did not complete. Every schema
-- operation is conditional so this is also safe after a successful original
-- migration and on fresh databases that replay the full history.
-- Keep dynamic no-op statements as SELECT 1. Some managed MySQL instances
-- enable ANSI_QUOTES, where double-quoted text is parsed as an identifier.

SET @nrms_has_invite_version := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_staff_membership'
    AND COLUMN_NAME = 'inviteVersion'
);
SET @nrms_add_invite_version_sql := IF(
  @nrms_has_invite_version = 0,
  'ALTER TABLE `nrms_staff_membership` ADD COLUMN `inviteVersion` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE nrms_add_invite_version FROM @nrms_add_invite_version_sql;
EXECUTE nrms_add_invite_version;
DEALLOCATE PREPARE nrms_add_invite_version;

SET @nrms_has_confirmed_at := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_staff_membership'
    AND COLUMN_NAME = 'confirmedAt'
);
SET @nrms_add_confirmed_at_sql := IF(
  @nrms_has_confirmed_at = 0,
  'ALTER TABLE `nrms_staff_membership` ADD COLUMN `confirmedAt` DATETIME(3) NULL',
  'SELECT 1'
);
PREPARE nrms_add_confirmed_at FROM @nrms_add_confirmed_at_sql;
EXECUTE nrms_add_confirmed_at;
DEALLOCATE PREPARE nrms_add_confirmed_at;

ALTER TABLE `nrms_staff_membership`
  MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING';

-- Collapse legacy multiple-role rows before adding the one-user/property
-- constraint. Preserve ACTIVE first, then PENDING, then DISABLED, preferring
-- the newest row within the same status.
DELETE membership
FROM `nrms_staff_membership` AS membership
INNER JOIN (
  SELECT `id`
  FROM (
    SELECT
      `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `propertyId`, `userId`
        ORDER BY
          CASE `status`
            WHEN 'ACTIVE' THEN 3
            WHEN 'PENDING' THEN 2
            ELSE 1
          END DESC,
          `id` DESC
      ) AS membership_rank
    FROM `nrms_staff_membership`
  ) AS ranked_memberships
  WHERE ranked_memberships.membership_rank > 1
) AS duplicate_memberships ON duplicate_memberships.`id` = membership.`id`;

UPDATE `nrms_staff_membership`
SET `confirmedAt` = `updatedAt`
WHERE `status` = 'ACTIVE' AND `confirmedAt` IS NULL;

SET @nrms_has_single_assignment_index := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_staff_membership'
    AND INDEX_NAME = 'nrms_staff_membership_propertyId_userId_key'
);
SET @nrms_add_single_assignment_index_sql := IF(
  @nrms_has_single_assignment_index = 0,
  'CREATE UNIQUE INDEX `nrms_staff_membership_propertyId_userId_key` ON `nrms_staff_membership`(`propertyId`, `userId`)',
  'SELECT 1'
);
PREPARE nrms_add_single_assignment_index FROM @nrms_add_single_assignment_index_sql;
EXECUTE nrms_add_single_assignment_index;
DEALLOCATE PREPARE nrms_add_single_assignment_index;

SET @nrms_has_legacy_role_index := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nrms_staff_membership'
    AND INDEX_NAME = 'nrms_staff_membership_propertyId_userId_role_key'
);
SET @nrms_drop_legacy_role_index_sql := IF(
  @nrms_has_legacy_role_index > 0,
  'DROP INDEX `nrms_staff_membership_propertyId_userId_role_key` ON `nrms_staff_membership`',
  'SELECT 1'
);
PREPARE nrms_drop_legacy_role_index FROM @nrms_drop_legacy_role_index_sql;
EXECUTE nrms_drop_legacy_role_index;
DEALLOCATE PREPARE nrms_drop_legacy_role_index;
