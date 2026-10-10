-- Karibu guest preferences (docs/KARIBU_BY_NOLSAF.md section 14).
-- One optional row per account, everything off by default. Birthday is day and
-- month only. New table only: no existing rows change. Runs on MySQL 8 and
-- MariaDB 11.8 (JSON is accepted by both).
CREATE TABLE `karibu_guest_preference` (
  `userId` INTEGER NOT NULL,
  `celebrateOptIn` BOOLEAN NOT NULL DEFAULT false,
  `birthdayDay` TINYINT NULL,
  `birthdayMonth` TINYINT NULL,
  `drinkLikes` JSON NULL,
  `dietaryTags` JSON NULL,
  `dietaryNote` VARCHAR(200) NULL,
  `shareWithProperty` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
