-- Payout safeguards. Additive and nullable: nothing changes for existing rows
-- or current payouts until an admin sets a threshold or a cap in Settings.
--
-- systemsetting:
--   payoutReviewThresholdTzs   hold any single payout at or above this amount
--   payoutDailyCapPerPayeeTzs  hold when one payee's rolling 24h total passes this
--   payoutRecentChangeHours    the RECENT_ACCOUNT_CHANGE window (was a hardcoded 72)
--
-- disbursement:
--   securityCleared*           records a second admin clearing a SECURITY_REVIEW
--                              hold, so the same unchanged risk does not hold the
--                              payout again at the next batch formation

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `payoutDailyCapPerPayeeTzs` INTEGER NULL,
    ADD COLUMN `payoutRecentChangeHours` INTEGER NULL DEFAULT 72,
    ADD COLUMN `payoutReviewThresholdTzs` INTEGER NULL;

-- AlterTable
ALTER TABLE `disbursement` ADD COLUMN `securityClearedAt` DATETIME(3) NULL,
    ADD COLUMN `securityClearedById` INTEGER NULL,
    ADD COLUMN `securityClearedFingerprint` VARCHAR(64) NULL;
