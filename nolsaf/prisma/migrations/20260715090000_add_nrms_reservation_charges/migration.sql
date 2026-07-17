-- NRMS guest folio: extra charges posted to a reservation (restaurant, bar,
-- laundry, minibar, room service, transport, damage, other). Immutable rows
-- with void-and-reason correction, mirroring external_payment_record.
-- Guest balance = reservation.totalAmount + reservation.chargesTotal
-- - reservation.amountPaid. Purely additive: no existing table is dropped
-- or rewritten; chargesTotal defaults to 0.00 so no backfill is needed.

CREATE TABLE IF NOT EXISTS `reservation_charge` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservationId` INT NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `description` VARCHAR(300) NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `postedById` INT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidReason` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `reservation_charge_reservationId_createdAt_idx` (`reservationId`, `createdAt`),
  KEY `reservation_charge_category_idx` (`category`),
  CONSTRAINT `reservation_charge_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reservation_charge_postedById_fkey`
    FOREIGN KEY (`postedById`) REFERENCES `user` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reservation`
  ADD COLUMN `chargesTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;
