CREATE TABLE `payout_withdrawal_otp_guard` (
  `ownerId` INTEGER NOT NULL,
  `failedAttempts` INTEGER NOT NULL DEFAULT 0,
  `lockedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ownerId`)
);
