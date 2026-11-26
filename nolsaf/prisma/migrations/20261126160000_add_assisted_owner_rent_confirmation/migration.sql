-- Long stay on an assisted listing: the owner confirms the rent the sales
-- partner set before the home can go live (docs/LONG_STAY_RENTALS.md 15.1).
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Six additive, nullable columns only: runs on both MySQL 8 (staging) and
-- MariaDB 11.8 (prod). Apply BEFORE deploying the API that reads them.

ALTER TABLE `sales_assisted_listing`
    ADD COLUMN `rentTermsFingerprint` CHAR(64) NULL,
    ADD COLUMN `rentConfirmSentAt` DATETIME(3) NULL,
    ADD COLUMN `rentLinkOpenedAt` DATETIME(3) NULL,
    ADD COLUMN `rentConfirmedFingerprint` CHAR(64) NULL,
    ADD COLUMN `rentConfirmedAt` DATETIME(3) NULL,
    ADD COLUMN `rentConfirmedVia` VARCHAR(12) NULL;
