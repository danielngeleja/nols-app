ALTER TABLE `nrms_guest_inquiry`
  ADD COLUMN `priority` VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `expectedValue` DECIMAL(14,2) NULL,
  ADD COLUMN `nextFollowUpAt` DATETIME(3) NULL,
  ADD COLUMN `followUpRemindedAt` DATETIME(3) NULL,
  ADD COLUMN `lostReason` VARCHAR(300) NULL,
  ADD COLUMN `quotationReference` VARCHAR(40) NULL,
  ADD COLUMN `quotationStatus` VARCHAR(20) NULL,
  ADD COLUMN `quotationAmount` DECIMAL(14,2) NULL,
  ADD COLUMN `quotationCurrency` VARCHAR(3) NULL,
  ADD COLUMN `quotationValidUntil` DATETIME(3) NULL,
  ADD COLUMN `quotationSentAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `nrms_guest_inquiry_quotationReference_key`
  ON `nrms_guest_inquiry`(`quotationReference`);

CREATE INDEX `nrms_guest_inquiry_property_follow_up_idx`
  ON `nrms_guest_inquiry`(`propertyId`, `nextFollowUpAt`);

CREATE INDEX `nrms_guest_inquiry_property_priority_status_idx`
  ON `nrms_guest_inquiry`(`propertyId`, `priority`, `status`);
