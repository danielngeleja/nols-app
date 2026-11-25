-- Owner first-payout policy settings (admin Settings, Payouts).
-- Prepared 2026-11-25. NOT APPLIED. Apply only with Daniel's approval, and
-- BEFORE deploying the code that reads these columns (the settings save reads
-- the whole systemsetting row). Plain additive DDL that runs on both MySQL 8
-- (staging) and MariaDB 11.8 (prod).
--
--   ownerFirstPayoutAutoMaxTzs       NULL keeps today's behaviour: every
--                                    owner's first payout is checked by a person.
--   ownerWithdrawalReviewAlertHours  hours before finance is alerted again about
--                                    a waiting owner withdrawal (default 4).

ALTER TABLE `systemsetting`
  ADD COLUMN `ownerFirstPayoutAutoMaxTzs` INTEGER NULL,
  ADD COLUMN `ownerWithdrawalReviewAlertHours` INTEGER NULL DEFAULT 4;
