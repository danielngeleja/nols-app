-- Long-stay listing terms: discounts for longer leases and monthly bill estimates.
-- Both optional JSON; existing rows keep NULL. Runs on MySQL 8 and MariaDB 11.8.
-- Apply after 20261121130000.

-- AlterTable
ALTER TABLE `long_stay_listing` ADD COLUMN `billEstimates` JSON NULL,
    ADD COLUMN `discounts` JSON NULL;

