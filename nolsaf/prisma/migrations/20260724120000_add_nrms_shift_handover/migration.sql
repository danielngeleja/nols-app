-- Drawer handover: an incoming cashier shift can be linked to the closed shift
-- it took over. UNIQUE guarantees a closed drawer is confirmed by exactly one
-- successor, even under concurrent takeover attempts.
ALTER TABLE `nrms_cashier_shift`
  ADD COLUMN `handoverFromId` INTEGER NULL;

CREATE UNIQUE INDEX `nrms_cashier_shift_handoverFromId_key` ON `nrms_cashier_shift`(`handoverFromId`);

ALTER TABLE `nrms_cashier_shift`
  ADD CONSTRAINT `nrms_cashier_shift_handoverFromId_fkey` FOREIGN KEY (`handoverFromId`) REFERENCES `nrms_cashier_shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
