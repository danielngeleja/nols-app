-- NRMS stock control milestone 6: insight and automation (docs/NRMS_STOCK_AND_PURCHASING.md)
--
-- NOT APPLIED. Prepared for review; run only after Daniel's approval.
-- Requires 20260928090000_add_nrms_supplier_payables to have run first.
--
-- Additive only: five columns on nrms_stock_settings, all nullable or defaulted.
--
--   digestFrequency / digestLastSentAt   owner stock digest (OFF by default)
--   deadStockDays                        threshold for the dead stock report
--   breakfastRecipe / breakfastLocationId  what one breakfast cover uses, and from which shelf

-- AlterTable
ALTER TABLE `nrms_stock_settings` ADD COLUMN `breakfastLocationId` INTEGER NULL,
    ADD COLUMN `breakfastRecipe` JSON NULL,
    ADD COLUMN `deadStockDays` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `digestFrequency` VARCHAR(10) NOT NULL DEFAULT 'OFF',
    ADD COLUMN `digestLastSentAt` DATETIME(3) NULL;

