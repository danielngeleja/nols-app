-- Forward-only reconciliation for databases created from the early workspace
-- revision. Fresh databases already have these columns; additions are guarded.
-- Existing names are preserved. Older rows use the current related records
-- because the original names were not captured before these columns existed.
SET @event_client_name_ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `event_hire_booking` ADD COLUMN `clientName` VARCHAR(160) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_hire_booking' AND COLUMN_NAME = 'clientName'
);
PREPARE event_name_repair FROM @event_client_name_ddl;
EXECUTE event_name_repair;
DEALLOCATE PREPARE event_name_repair;

SET @event_venue_title_ddl = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `event_hire_booking` ADD COLUMN `venueTitle` VARCHAR(200) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_hire_booking' AND COLUMN_NAME = 'venueTitle'
);
PREPARE event_name_repair FROM @event_venue_title_ddl;
EXECUTE event_name_repair;
DEALLOCATE PREPARE event_name_repair;

UPDATE `event_hire_booking` b
LEFT JOIN `event_hire_request` r ON r.`id` = b.`requestId`
LEFT JOIN `user` u ON u.`id` = r.`clientUserId`
LEFT JOIN `property` p ON p.`id` = r.`propertyId`
SET b.`clientName` = COALESCE(NULLIF(TRIM(b.`clientName`), ''), LEFT(COALESCE(NULLIF(TRIM(u.`fullName`), ''), NULLIF(TRIM(u.`name`), ''), 'NoLSAF client'), 160)),
    b.`venueTitle` = COALESCE(NULLIF(TRIM(b.`venueTitle`), ''), LEFT(COALESCE(NULLIF(TRIM(p.`title`), ''), 'Event venue'), 200))
WHERE b.`clientName` IS NULL OR TRIM(b.`clientName`) = '' OR b.`venueTitle` IS NULL OR TRIM(b.`venueTitle`) = '';

ALTER TABLE `event_hire_booking`
  MODIFY COLUMN `clientName` VARCHAR(160) NOT NULL,
  MODIFY COLUMN `venueTitle` VARCHAR(200) NOT NULL;
