-- Reconcile the fiscal tables with Prisma-managed @updatedAt semantics.
--
-- The original additive fiscal migration used ON UPDATE CURRENT_TIMESTAMP(3),
-- while schema.prisma intentionally leaves these defaults to Prisma. Keep the
-- shared migration immutable and remove only the two database defaults here.
ALTER TABLE `nrms_fiscal_connection`
  ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `nrms_fiscal_receipt`
  ALTER COLUMN `updatedAt` DROP DEFAULT;
