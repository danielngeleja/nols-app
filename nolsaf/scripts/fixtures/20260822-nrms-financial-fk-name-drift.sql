-- Recreate the constraint-name-only drift observed on the restored production
-- snapshot. Referenced columns and referential actions remain canonical.

ALTER TABLE `nrms_ledger_transaction`
  DROP FOREIGN KEY `nrms_ledger_transaction_propertyId_fkey`,
  DROP FOREIGN KEY `nrms_ledger_transaction_businessDayId_fkey`,
  DROP FOREIGN KEY `nrms_ledger_transaction_nightAuditRunId_fkey`,
  ADD CONSTRAINT `nrms_ledger_tx_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_ledger_tx_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_ledger_tx_nightAuditRunId_fkey` FOREIGN KEY (`nightAuditRunId`) REFERENCES `nrms_night_audit_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_night_audit_run`
  DROP FOREIGN KEY `nrms_night_audit_run_propertyId_fkey`,
  DROP FOREIGN KEY `nrms_night_audit_run_businessDayId_fkey`,
  DROP FOREIGN KEY `nrms_night_audit_run_startedById_fkey`,
  DROP FOREIGN KEY `nrms_night_audit_run_closedById_fkey`,
  ADD CONSTRAINT `nrms_night_audit_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_businessDayId_fkey` FOREIGN KEY (`businessDayId`) REFERENCES `nrms_business_day`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_night_audit_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
