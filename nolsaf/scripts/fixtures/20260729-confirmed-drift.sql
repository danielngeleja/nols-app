-- Disposable validation fixture only. Starting from the canonical Prisma
-- schema, recreate the exact six uncovered objects found by the audit.
ALTER TABLE `owner_payg_account`
  DROP COLUMN `maxStaff`,
  DROP COLUMN `maxOutlets`,
  DROP COLUMN `maxMenuItems`,
  DROP COLUMN `maxOrderPoints`,
  DROP COLUMN `maxRooms`;

DROP INDEX `channel_room_mapping_connectionId_roomTypeId_externalId_key`
  ON `channel_room_mapping`;

CREATE UNIQUE INDEX `channel_room_mapping_connectionId_externalId_key`
  ON `channel_room_mapping` (`connectionId`, `externalId`);
