ALTER TABLE `nrms_outlet_order`
  ADD COLUMN `guestRating` INTEGER NULL,
  ADD COLUMN `guestFeedback` VARCHAR(500) NULL,
  ADD COLUMN `tipIntent` VARCHAR(20) NULL,
  ADD COLUMN `tipSuggestedAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `feedbackAt` DATETIME(3) NULL,
  ADD COLUMN `paymentAmountReceived` DECIMAL(12, 2) NULL,
  ADD COLUMN `tipAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `tipRecipientId` INTEGER NULL,
  ADD COLUMN `tipConfirmedById` INTEGER NULL,
  ADD COLUMN `tipMethod` VARCHAR(30) NULL,
  ADD COLUMN `tipConfirmedAt` DATETIME(3) NULL;

CREATE INDEX `nrms_outlet_order_tipRecipientId_idx` ON `nrms_outlet_order`(`tipRecipientId`);
CREATE INDEX `nrms_outlet_order_tipConfirmedById_idx` ON `nrms_outlet_order`(`tipConfirmedById`);

ALTER TABLE `nrms_outlet_order`
  ADD CONSTRAINT `nrms_outlet_order_tipRecipientId_fkey`
    FOREIGN KEY (`tipRecipientId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_outlet_order_tipConfirmedById_fkey`
    FOREIGN KEY (`tipConfirmedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
