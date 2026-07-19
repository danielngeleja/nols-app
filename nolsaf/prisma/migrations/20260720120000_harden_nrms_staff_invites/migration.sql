-- Keep one authoritative staff assignment per user and property. When legacy
-- duplicates exist, retain an ACTIVE row first, then PENDING, then DISABLED;
-- within the same status retain the most recently created assignment.
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

ALTER TABLE `nrms_staff_membership`
  ADD COLUMN `inviteVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING';

-- Existing ACTIVE rows predate explicit confirmation timestamps. Their latest
-- update is the closest available activation timestamp for the admin record.
UPDATE `nrms_staff_membership`
SET `confirmedAt` = `updatedAt`
WHERE `status` = 'ACTIVE' AND `confirmedAt` IS NULL;

CREATE UNIQUE INDEX `nrms_staff_membership_propertyId_userId_key`
  ON `nrms_staff_membership`(`propertyId`, `userId`);
DROP INDEX `nrms_staff_membership_propertyId_userId_role_key` ON `nrms_staff_membership`;
