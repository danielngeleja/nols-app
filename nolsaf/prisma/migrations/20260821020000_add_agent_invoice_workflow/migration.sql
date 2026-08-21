-- Agent bookings use the same immutable NRMS master-folio / Pro Forma ledger
-- as group reservations. Exactly one commercial source is assigned by the
-- application: either block_id or agent_booking_request_id.
ALTER TABLE `nrms_master_folio`
  MODIFY `blockId` INTEGER NULL,
  ADD COLUMN `agentBookingRequestId` INTEGER NULL;

CREATE UNIQUE INDEX `nrms_master_folio_agentBookingRequestId_key`
  ON `nrms_master_folio`(`agentBookingRequestId`);

ALTER TABLE `nrms_master_folio`
  ADD CONSTRAINT `nrms_master_folio_agentBookingRequestId_fkey`
  FOREIGN KEY (`agentBookingRequestId`) REFERENCES `nrms_agent_booking_request`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `nrms_master_folio_pro_forma`
  ADD COLUMN `payerMarkedPaidAt` DATETIME(3) NULL,
  ADD COLUMN `payerMarkedPaidById` INTEGER NULL,
  ADD COLUMN `payerPaymentReference` VARCHAR(120) NULL;
