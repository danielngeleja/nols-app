-- Adds the AzamPay checkoutSessionId column to nrms_service_payment_token.
-- schema.prisma added this field (commit 76f71c96) without a migration, so
-- Prisma Client now selects a column the live table does not have yet
-- (P2022 ColumnNotFound on admin.nrms.js findMany calls).
ALTER TABLE `nrms_service_payment_token`
  ADD COLUMN `checkoutSessionId` VARCHAR(120) NULL AFTER `method`;

ALTER TABLE `nrms_service_payment_token`
  ADD UNIQUE INDEX `nrms_service_payment_token_checkoutSessionId_key`(`checkoutSessionId`);
