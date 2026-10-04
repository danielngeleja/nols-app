-- Record who voided an outlet sale.
--
-- WHY
-- `nrms_outlet_order` already records `createdById`, `confirmedById` and
-- `settledById`, but a void writes only `voidedAt` and `voidReason`. Voiding a
-- SETTLED, OUTLET_PAYMENT sale reverses money that was already taken from a
-- guest, and today nothing in the row says who did it. That is the one piece of
-- evidence an owner needs after the fact, and it is also the data separation of
-- duties depends on: without it there is no way to say that the person who
-- raised the sale may not be the person who reverses it.
--
-- SAFETY
-- Additive only: one nullable column, one index, one foreign key. No column is
-- dropped, no column changes type or nullability, and no existing row is
-- rewritten. Sales voided before this migration keep `voidedById` NULL, which
-- reads correctly as "voided before attribution was recorded" rather than being
-- backfilled with a guess.
--
-- ON DELETE SET NULL, matching `settledById` and the other actor columns on this
-- table: deleting a staff account must not delete the record of the void.
--
-- This migration is not applied by the change that introduces it.

-- AlterTable
ALTER TABLE `nrms_outlet_order` ADD COLUMN `voidedById` INTEGER NULL;

-- CreateIndex
CREATE INDEX `nrms_outlet_order_voidedById_idx` ON `nrms_outlet_order`(`voidedById`);

-- AddForeignKey
ALTER TABLE `nrms_outlet_order` ADD CONSTRAINT `nrms_outlet_order_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
