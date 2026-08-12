-- Owner/manager acknowledgment that a closed shift's sales are authentic.
-- Distinct from approvedById, which is set to whoever closed the shift and
-- carries no independent verification.
ALTER TABLE `nrms_cashier_shift`
  ADD COLUMN `ownerSignedOffAt` DATETIME(3) NULL,
  ADD COLUMN `ownerSignedOffById` INTEGER NULL;

ALTER TABLE `nrms_cashier_shift`
  ADD CONSTRAINT `nrms_cashier_shift_ownerSignedOffById_fkey` FOREIGN KEY (`ownerSignedOffById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
