ALTER TABLE `payout_account` MODIFY `provider` VARCHAR(160) NOT NULL;
ALTER TABLE `disbursement` MODIFY `bankName` VARCHAR(160) NOT NULL,
    MODIFY `operator` VARCHAR(160) NULL;
ALTER TABLE `disbursement_event` MODIFY `operator` VARCHAR(160) NULL;
