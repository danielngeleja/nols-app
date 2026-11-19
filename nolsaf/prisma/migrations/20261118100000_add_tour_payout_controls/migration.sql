-- Tour operator payout controls (apps/api/src/lib/tourPayoutControls.ts).
--
-- systemsetting.tourAdvanceExposureLimits   per-tier cap (TZS) on advance money
--                                           one operator holds across unfinished
--                                           trips; null uses the code defaults
-- systemsetting.tourPayoutSeparateApprover  approver must differ from verifier
--
-- Additive only. Runs on MySQL 8 (staging) and MariaDB 11.8 (prod).
-- Until applied, the API uses the built-in defaults (limits on, separate
-- approver on), so the controls are enforced from the deploy either way.

ALTER TABLE `systemsetting`
    ADD COLUMN `tourAdvanceExposureLimits` JSON NULL,
    ADD COLUMN `tourPayoutSeparateApprover` BOOLEAN NOT NULL DEFAULT true;
