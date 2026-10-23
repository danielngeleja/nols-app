ALTER TABLE `payout_withdrawal_allocation`
  ADD COLUMN `cancelledAt` DATETIME(3) NULL;

CREATE INDEX `payout_wd_challenge_handoff_due_idx`
  ON `payout_withdrawal_challenge`(`planVersion`, `handoffStatus`, `handoffNextAttemptAt`);
