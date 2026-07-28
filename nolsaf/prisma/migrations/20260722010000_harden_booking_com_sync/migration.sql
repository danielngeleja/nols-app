-- Booking.com internal readiness hardening.
-- Reservation identity is database-enforced, inbox processing receives a
-- recoverable lease, and rate mappings are scoped to room/rate combinations.

ALTER TABLE `reservation`
  ADD UNIQUE KEY `reservation_property_source_external_ref_key` (`propertyId`, `source`, `externalRef`);

ALTER TABLE `channel_inbound_event`
  ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
  ADD COLUMN `attemptCount` INT NOT NULL DEFAULT 0;

ALTER TABLE `channel_rate_mapping`
  DROP INDEX `channel_rate_mapping_connectionId_externalId_key`,
  ADD UNIQUE KEY `channel_rate_mapping_connectionId_roomTypeId_externalId_key` (`connectionId`, `roomTypeId`, `externalId`);
