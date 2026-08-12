ALTER TABLE `cancellation_requests`
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedByAdminId` INTEGER NULL,
  ADD COLUMN `refundAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `refundProvider` VARCHAR(80) NULL,
  ADD COLUMN `refundReference` VARCHAR(160) NULL,
  ADD COLUMN `refundInitiatedAt` DATETIME(3) NULL,
  ADD COLUMN `refundedAt` DATETIME(3) NULL;

UPDATE `cancellation_requests`
SET `status` = 'REFUND_PENDING',
    `refundInitiatedAt` = COALESCE(`refundInitiatedAt`, `reviewedAt`, `updatedAt`)
WHERE `status` = 'PROCESSING';
