-- Manual NRMS payment submissions use a client-stable idempotency key. A
-- browser retry or repeated network delivery can therefore return the same
-- receipt instead of recording the money twice.
ALTER TABLE `external_payment_record`
  ADD COLUMN `idempotencyKey` VARCHAR(120) NULL;

CREATE UNIQUE INDEX `external_payment_record_reservationId_idempotencyKey_key`
  ON `external_payment_record` (`reservationId`, `idempotencyKey`);

ALTER TABLE `nrms_master_folio_payment`
  ADD COLUMN `idempotencyKey` VARCHAR(120) NULL;

CREATE UNIQUE INDEX `nrms_master_folio_payment_masterFolioId_idempotencyKey_key`
  ON `nrms_master_folio_payment` (`masterFolioId`, `idempotencyKey`);
