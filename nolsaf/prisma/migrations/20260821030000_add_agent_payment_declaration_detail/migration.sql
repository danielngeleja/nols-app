-- The agency now declares HOW it paid, not just a bare reference. The property
-- needs the method and the paying account name to match a credit in its own
-- account before it confirms receipt.
--
-- Both columns are nullable: declarations made before this migration have
-- neither, and a CASH declaration has no account name by definition.
ALTER TABLE `nrms_master_folio_pro_forma`
  ADD COLUMN `payerPaymentMethod` VARCHAR(20) NULL,
  ADD COLUMN `payerPaymentAccountName` VARCHAR(160) NULL;
