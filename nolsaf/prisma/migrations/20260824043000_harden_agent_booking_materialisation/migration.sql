-- Make the agent -> hotel -> group handover durable and retry-safe.
-- Existing bookingRequest.reservationId remains the immutable anonymous
-- placeholder; materializedAgentBookingRequestId identifies every real stay.

ALTER TABLE `nrms_agent_booking_request`
  ADD COLUMN `clientMutationId` VARCHAR(120) NULL;

CREATE UNIQUE INDEX `nrms_agent_booking_request_linkId_clientMutationId_key`
  ON `nrms_agent_booking_request`(`linkId`, `clientMutationId`);

ALTER TABLE `reservation`
  ADD COLUMN `materializedAgentBookingRequestId` INTEGER NULL;

CREATE INDEX `reservation_materializedAgentBookingRequestId_status_idx`
  ON `reservation`(`materializedAgentBookingRequestId`, `status`);

ALTER TABLE `reservation`
  ADD CONSTRAINT `reservation_materializedAgentBookingRequestId_fkey`
  FOREIGN KEY (`materializedAgentBookingRequestId`)
  REFERENCES `nrms_agent_booking_request`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_agent_booking_guest`
  ADD COLUMN `reservationId` INTEGER NULL;

CREATE INDEX `nrms_agent_booking_guest_reservationId_idx`
  ON `nrms_agent_booking_guest`(`reservationId`);

ALTER TABLE `nrms_agent_booking_guest`
  ADD CONSTRAINT `nrms_agent_booking_guest_reservationId_fkey`
  FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill already-split bookings through the master folio's canonical block.
UPDATE `reservation` AS `stay`
INNER JOIN `nrms_group_block` AS `block` ON `block`.`groupId` = `stay`.`groupId`
INNER JOIN `nrms_master_folio` AS `folio` ON `folio`.`blockId` = `block`.`id`
SET `stay`.`materializedAgentBookingRequestId` = `folio`.`agentBookingRequestId`
WHERE `folio`.`agentBookingRequestId` IS NOT NULL
  AND `stay`.`materializedAgentBookingRequestId` IS NULL;

-- Agent blocks are created empty and picked up in declared room-number order,
-- so the stable external-reference suffix is the manifest party number.
UPDATE `nrms_agent_booking_guest` AS `guest`
INNER JOIN `reservation` AS `stay`
  ON `stay`.`materializedAgentBookingRequestId` = `guest`.`bookingRequestId`
 AND CAST(SUBSTRING_INDEX(`stay`.`externalRef`, '-', -1) AS UNSIGNED) = `guest`.`roomNumber`
SET `guest`.`reservationId` = `stay`.`id`
WHERE `guest`.`reservationId` IS NULL;
