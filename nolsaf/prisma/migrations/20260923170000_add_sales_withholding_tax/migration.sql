-- Sales partner withholding tax and TIN.
--
-- Additive only: two new columns on sales_payout_request (the default 0.00
-- keeps every existing payout reconciling as approved - deduction = net) and
-- one nullable column on sales_partner_profile. No existing data is changed.
--
-- NOT YET APPLIED. Apply before deploying the API build that reads these
-- columns; Prisma selects all scalar fields on include-style queries, so the
-- code and this migration must go out together.

ALTER TABLE `sales_payout_request`
  ADD COLUMN `withholdingTaxRate` DECIMAL(5, 2) NULL,
  ADD COLUMN `withholdingTaxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE `sales_partner_profile`
  ADD COLUMN `taxIdNumber` VARCHAR(20) NULL;
