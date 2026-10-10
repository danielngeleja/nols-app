-- A previously issued but voided welcome may be replaced in a later month.
-- Keep its original createdAt while charging the new commitment to its issue month.
ALTER TABLE `karibu_gesture`
  ADD COLUMN `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `karibu_gesture` SET `issuedAt` = `createdAt`;

CREATE INDEX `karibu_gesture_issuedAt_status_idx`
  ON `karibu_gesture`(`issuedAt`, `status`);

CREATE INDEX `karibu_gesture_propertyId_issuedAt_status_idx`
  ON `karibu_gesture`(`propertyId`, `issuedAt`, `status`);
