-- Historical prerequisite for the tour-booking review link migration.
-- The table existed in deployed databases but its creation was absent from
-- migration history, preventing clean shadow-database replay.
CREATE TABLE `agent_reviews` (
  `id`                  INT         NOT NULL AUTO_INCREMENT,
  `agentId`             INT         NOT NULL,
  `userId`              INT         NOT NULL,
  `planRequestId`       INT         NULL,
  `punctualityRating`   INT         NOT NULL,
  `customerCareRating`  INT         NOT NULL,
  `communicationRating` INT         NOT NULL,
  `comment`             TEXT        NULL,
  `createdAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL,

  INDEX `agent_reviews_agentId_idx` (`agentId`),
  INDEX `agent_reviews_userId_idx` (`userId`),
  INDEX `agent_reviews_planRequestId_idx` (`planRequestId`),
  INDEX `agent_reviews_createdAt_idx` (`createdAt`),
  INDEX `agent_reviews_agentId_createdAt_idx` (`agentId`, `createdAt`),
  PRIMARY KEY (`id`),

  CONSTRAINT `agent_reviews_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `agent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `agent_reviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `agent_reviews_planRequestId_fkey` FOREIGN KEY (`planRequestId`) REFERENCES `plan_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
