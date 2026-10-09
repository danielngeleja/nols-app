ALTER TABLE `karibu_gesture`
  ADD COLUMN `guestConfirmedReceived` BOOLEAN NULL,
  ADD COLUMN `guestFeedbackRating` INTEGER NULL,
  ADD COLUMN `guestFeedbackNote` VARCHAR(500) NULL,
  ADD COLUMN `guestFeedbackAt` DATETIME(3) NULL;
