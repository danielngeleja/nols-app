-- When the owner first opened their latest "confirm the rent" link, shown to
-- the admin in the waiting-for-owner dialog (docs/LONG_STAY_RENTALS.md 15.1).
-- Follow-up to 20261126160000, which was applied before this column was added.
-- Prepared 2026-11-27. NOT APPLIED. Apply only with Daniel's approval.
-- One additive, nullable column: runs on both MySQL 8 (staging) and
-- MariaDB 11.8 (prod). Apply BEFORE deploying the API that reads it.

ALTER TABLE `sales_assisted_listing` ADD COLUMN `rentLinkOpenedAt` DATETIME(3) NULL;
