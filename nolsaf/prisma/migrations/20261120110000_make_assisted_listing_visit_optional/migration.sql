-- Sales assisted listing: the on-site visit becomes optional evidence.
--
-- Partners cannot reach every property, so a listing may start without a
-- verified visit. When one exists it is still linked; admin review flags its
-- absence. Deleting a visit no longer blocks; the link is cleared instead.
--
-- Follows 20261120100000_add_sales_assisted_listing. MySQL 8 and MariaDB 11.8.
-- Prepared 2026-11-20. Not applied anywhere until Daniel approves.

-- DropForeignKey
ALTER TABLE `sales_assisted_listing` DROP FOREIGN KEY `sales_assisted_listing_visitId_fkey`;

-- AlterTable
ALTER TABLE `sales_assisted_listing` MODIFY `visitId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `sales_assisted_listing` ADD CONSTRAINT `sales_assisted_listing_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `sales_lead_visit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

