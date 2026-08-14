-- iCal calendar connections (Airbnb and any other OTA that publishes a calendar).
--
-- channel_calendar_feed and channel_calendar_event_map already exist from the
-- channel foundation migration but were never wired to anything. A calendar is
-- issued per listing and a listing is one room type here, so a feed needs to
-- say which room type it speaks for before it can block or publish inventory.

-- exportBuffer is the safety margin on a published calendar: the number of
-- rooms held back from the provider, because a provider that reads the feed
-- hours late can otherwise sell a room that was sold here minutes ago.
ALTER TABLE `channel_calendar_feed`
  ADD COLUMN `roomTypeId` INT NULL AFTER `connectionId`,
  ADD COLUMN `label` VARCHAR(160) NULL AFTER `roomTypeId`,
  ADD COLUMN `exportBuffer` INT NOT NULL DEFAULT 0 AFTER `label`;

ALTER TABLE `channel_calendar_feed`
  ADD KEY `channel_calendar_feed_roomTypeId_idx` (`roomTypeId`),
  ADD KEY `channel_calendar_feed_urlFingerprint_idx` (`urlFingerprint`);

ALTER TABLE `channel_calendar_feed`
  ADD CONSTRAINT `channel_calendar_feed_roomTypeId_fkey`
  FOREIGN KEY (`roomTypeId`) REFERENCES `room_type` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Calendar events are availability facts, not guest reservations. Keep the
-- old reservationId column for compatibility with any pre-release test data,
-- but point all new imports at a generated availability block. A short missing
-- counter prevents one incomplete provider response from reopening inventory.
ALTER TABLE `channel_calendar_event_map`
  ADD COLUMN `availabilityBlockId` INT NULL AFTER `reservationId`,
  ADD COLUMN `missingCount` INT NOT NULL DEFAULT 0 AFTER `lastSeenAt`,
  ADD UNIQUE KEY `channel_calendar_event_map_availabilityBlockId_key` (`availabilityBlockId`);

ALTER TABLE `channel_calendar_event_map`
  ADD CONSTRAINT `channel_calendar_event_map_availabilityBlockId_fkey`
  FOREIGN KEY (`availabilityBlockId`) REFERENCES `propertyavailabilityblock` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
