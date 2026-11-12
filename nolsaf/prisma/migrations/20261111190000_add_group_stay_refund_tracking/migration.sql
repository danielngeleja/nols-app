-- Group stay refund tracking (prepared 2026-11-11, NOT applied; apply only with Daniel's approval)
--
-- A paid group stay that NoLSAF cancels now records the refund it owes the guest:
-- refundStatus NONE -> DUE -> REFUNDED, the amount returned, what NoLSAF keeps (never more
-- than its own commission), and the transfer reference. Needed before the first fully
-- prepaid Agency Desk group, where the guest pays the whole stay to NoLSAF.
--
-- Requires 20261111170000_add_sales_agency_desk_phase2. Six added columns, one with a
-- default (instant on MySQL 8 and MariaDB 11.8). Existing rows get NONE.
--
-- Rollback (only if no code depends on it yet):
--   ALTER TABLE `group_bookings` DROP COLUMN `refundStatus`, DROP COLUMN `refundAmount`,
--     DROP COLUMN `refundRetainedAmount`, DROP COLUMN `refundReason`, DROP COLUMN `refundedAt`,
--     DROP COLUMN `refundRef`;

-- AlterTable
ALTER TABLE `group_bookings` ADD COLUMN `refundStatus` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `refundAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `refundRetainedAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `refundReason` VARCHAR(300) NULL,
    ADD COLUMN `refundedAt` DATETIME(3) NULL,
    ADD COLUMN `refundRef` VARCHAR(120) NULL;
