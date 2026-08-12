-- AlterTable: hotel-direct payment instructions shown on the guest QR order page
ALTER TABLE `property` ADD COLUMN `nrmsGuestPayInstructions` JSON NULL;
