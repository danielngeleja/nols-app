-- Which marketing channel brought each booking, tour booking and tenancy
-- (docs/CHANNEL_ATTRIBUTION.md). Reporting only.
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Additive only (one new table, no foreign keys), runs on both MySQL 8
-- (staging) and MariaDB 11.8 (prod). Until it exists, recording is skipped
-- silently and the Channels report says a database update is needed.

CREATE TABLE `acquisition_source` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `targetType` VARCHAR(16) NOT NULL,
    `targetId` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `source` VARCHAR(60) NULL,
    `medium` VARCHAR(60) NULL,
    `campaign` VARCHAR(80) NULL,
    `detail` VARCHAR(60) NULL,
    `landingPath` VARCHAR(120) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `acquisition_source_targetType_targetId_key`(`targetType`, `targetId`),
    INDEX `acquisition_source_channel_createdAt_idx`(`channel`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
