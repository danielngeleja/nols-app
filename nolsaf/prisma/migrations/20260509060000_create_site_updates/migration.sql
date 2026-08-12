-- Historical prerequisite for the site_updates index migration.
-- The table existed in deployed databases but its creation was absent from
-- migration history, preventing clean shadow-database replay.
CREATE TABLE `site_updates` (
  `id`        VARCHAR(64)  NOT NULL,
  `title`     VARCHAR(200) NOT NULL,
  `content`   TEXT         NOT NULL,
  `images`    JSON         NULL,
  `videos`    JSON         NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
