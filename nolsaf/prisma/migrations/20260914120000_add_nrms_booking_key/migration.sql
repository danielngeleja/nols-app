ALTER TABLE `property`
  ADD COLUMN `nrmsBookingKey` VARCHAR(40) NULL;

-- Existing properties receive stable opaque identifiers before the column is
-- made mandatory. UUID() is evaluated per row by MySQL.
UPDATE `property`
SET `nrmsBookingKey` = LOWER(REPLACE(UUID(), '-', ''))
WHERE `nrmsBookingKey` IS NULL;

ALTER TABLE `property`
  MODIFY `nrmsBookingKey` VARCHAR(40) NOT NULL;

CREATE UNIQUE INDEX `property_nrmsBookingKey_key`
  ON `property`(`nrmsBookingKey`);
