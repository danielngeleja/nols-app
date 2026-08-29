-- Keep one active property-scoped inquiry for each Meta sender. Historical
-- conversations remain available; their active key is intentionally NULL.
ALTER TABLE `nrms_guest_inquiry`
  ADD COLUMN `activeConversationKey` VARCHAR(64) NULL;

-- If an older deployment already received the same sender concurrently, keep
-- the newest inquiry live and close the older duplicate without deleting its
-- transcript or audit history.
UPDATE `nrms_guest_inquiry` AS older
INNER JOIN `nrms_guest_inquiry` AS newer
  ON newer.`propertyId` = older.`propertyId`
 AND newer.`channel` = older.`channel`
 AND newer.`externalConversationId` = older.`externalConversationId`
 AND newer.`id` > older.`id`
SET older.`status` = 'CLOSED',
    older.`closedAt` = COALESCE(older.`closedAt`, CURRENT_TIMESTAMP(3)),
    older.`version` = older.`version` + 1
WHERE older.`externalConversationId` IS NOT NULL
  AND older.`status` IN ('NEW', 'OPEN', 'WAITING_GUEST')
  AND newer.`status` IN ('NEW', 'OPEN', 'WAITING_GUEST');

UPDATE `nrms_guest_inquiry`
SET `activeConversationKey` = SHA2(
  CONCAT(`propertyId`, ':', UPPER(TRIM(`channel`)), ':', TRIM(`externalConversationId`)),
  256
)
WHERE `externalConversationId` IS NOT NULL
  AND `status` IN ('NEW', 'OPEN', 'WAITING_GUEST');

CREATE UNIQUE INDEX `nrms_guest_inquiry_active_conversation_key`
  ON `nrms_guest_inquiry`(`activeConversationKey`);
