-- The owner's email on an assisted listing, required from the partner but kept
-- PENDING until the owner proves it with a code on the password setup page
-- (lib/ownerPendingEmail.ts). Only then is it set on the owner's account.
-- Prepared 2026-11-27. NOT APPLIED. Apply only with Daniel's approval.
-- Three additive, nullable columns: runs on both MySQL 8 (staging) and
-- MariaDB 11.8 (prod). Apply BEFORE deploying the API that reads them.

ALTER TABLE `sales_assisted_listing`
    ADD COLUMN `ownerEmail` VARCHAR(190) NULL,
    ADD COLUMN `ownerEmailStatus` VARCHAR(10) NULL,
    ADD COLUMN `ownerEmailDecidedAt` DATETIME(3) NULL;
