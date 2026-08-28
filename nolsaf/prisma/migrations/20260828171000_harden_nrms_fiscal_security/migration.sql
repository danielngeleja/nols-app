-- Security hardening for owner-managed TRA fiscal receipting.
-- Forward-only because the base Fiscal migration has already reached the local
-- development database. No statutory receipt is rewritten or removed.

ALTER TABLE `nrms_fiscal_connection`
  ADD COLUMN `pendingMode` VARCHAR(20) NULL AFTER `mode`,
  ADD COLUMN `suspendedFromStatus` VARCHAR(20) NULL AFTER `status`;

ALTER TABLE `nrms_fiscal_receipt`
  ADD COLUMN `submissionKey` VARCHAR(36) NULL AFTER `status`,
  ADD COLUMN `deliveryLeaseToken` VARCHAR(36) NULL AFTER `lastError`,
  ADD COLUMN `deliveryLeaseExpiresAt` DATETIME(3) NULL AFTER `deliveryLeaseToken`;

-- Backfill any local-development rows before enforcing the non-null stable key.
UPDATE `nrms_fiscal_receipt`
SET `submissionKey` = UUID()
WHERE `submissionKey` IS NULL;

ALTER TABLE `nrms_fiscal_receipt`
  MODIFY COLUMN `submissionKey` VARCHAR(36) NOT NULL,
  ADD UNIQUE KEY `nrms_fiscal_receipt_submissionKey_key` (`submissionKey`),
  ADD KEY `nrms_fiscal_receipt_status_deliveryLeaseExpiresAt_idx` (`status`, `deliveryLeaseExpiresAt`);

-- Statutory identity and receipts outlive ordinary property deletion. A
-- property holding fiscal history must be archived, not cascade-deleted.
ALTER TABLE `nrms_fiscal_connection`
  DROP FOREIGN KEY `nrms_fiscal_connection_propertyId_fkey`,
  DROP FOREIGN KEY `nrms_fiscal_connection_acknowledgedById_fkey`;

ALTER TABLE `nrms_fiscal_connection`
  ADD CONSTRAINT `nrms_fiscal_connection_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_fiscal_connection_acknowledgedById_fkey`
    FOREIGN KEY (`acknowledgedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_fiscal_credential_version`
  DROP FOREIGN KEY `nrms_fiscal_credential_version_connectionId_fkey`;

ALTER TABLE `nrms_fiscal_credential_version`
  ADD CONSTRAINT `nrms_fiscal_credential_version_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `nrms_fiscal_connection` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `nrms_fiscal_receipt`
  DROP FOREIGN KEY `nrms_fiscal_receipt_propertyId_fkey`,
  DROP FOREIGN KEY `nrms_fiscal_receipt_connectionId_fkey`;

ALTER TABLE `nrms_fiscal_receipt`
  ADD CONSTRAINT `nrms_fiscal_receipt_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_fiscal_receipt_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `nrms_fiscal_connection` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Corrections are new credit-note rows. Even a direct ORM/SQL delete cannot
-- erase the original statutory document.
CREATE TRIGGER `nrms_fiscal_receipt_prevent_delete`
  BEFORE DELETE ON `nrms_fiscal_receipt`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fiscal receipts are immutable and cannot be deleted';
