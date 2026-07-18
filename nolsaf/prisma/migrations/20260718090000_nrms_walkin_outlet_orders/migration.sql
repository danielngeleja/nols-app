-- Milestone 1 of NRMS QR ordering (docs/NRMS_QR_ORDERING.md): walk-in and
-- non-resident outlet sales. reservationId becomes optional; orders without a
-- stay carry a customerLabel and settle only as direct outlet payments.
-- Purely additive/loosening: no rows change, the FK stays for non-null values.

ALTER TABLE `nrms_outlet_order`
  MODIFY COLUMN `reservationId` INT NULL,
  ADD COLUMN `customerLabel` VARCHAR(120) NULL;
