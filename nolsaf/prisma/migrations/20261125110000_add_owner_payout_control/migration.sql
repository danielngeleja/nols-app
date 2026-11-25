-- Admin payout controls per owner: pause payouts, always check payouts.
-- Prepared 2026-11-25. NOT APPLIED. Apply only with Daniel's approval.
-- Additive only (one new table), runs on both MySQL 8 (staging) and
-- MariaDB 11.8 (prod). Until it exists the code treats every owner as having
-- no controls, and the admin controls report that the update is needed.

CREATE TABLE `owner_payout_control` (
  `ownerId` INTEGER NOT NULL,
  `holdAt` DATETIME(3) NULL,
  `holdReason` VARCHAR(300) NULL,
  `holdById` INTEGER NULL,
  `alwaysReview` BOOLEAN NOT NULL DEFAULT false,
  `alwaysReviewReason` VARCHAR(300) NULL,
  `alwaysReviewById` INTEGER NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ownerId`)
);
