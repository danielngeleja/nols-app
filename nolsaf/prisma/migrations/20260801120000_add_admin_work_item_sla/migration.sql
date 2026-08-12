-- CreateTable
CREATE TABLE `admin_work_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sourceType` VARCHAR(60) NOT NULL,
    `sourceId` VARCHAR(120) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `summary` TEXT NOT NULL,
    `subject` VARCHAR(240) NOT NULL,
    `detailHref` VARCHAR(500) NOT NULL,
    `actionLabel` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `slaPolicyVersion` VARCHAR(20) NOT NULL DEFAULT '2026-08',
    `responseTargetMinutes` INTEGER NOT NULL,
    `resolutionTargetMinutes` INTEGER NOT NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `responseDueAt` DATETIME(3) NOT NULL,
    `resolutionDueAt` DATETIME(3) NOT NULL,
    `operationalDueAt` DATETIME(3) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedById` INTEGER NULL,
    `assignedToId` INTEGER NULL,
    `assignedTeam` VARCHAR(80) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` INTEGER NULL,
    `resolutionNote` VARCHAR(1000) NULL,
    `lastObservedAt` DATETIME(3) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_work_item_sourceType_sourceId_key`(`sourceType`, `sourceId`),
    INDEX `admin_work_item_status_severity_idx`(`status`, `severity`),
    INDEX `admin_work_item_assignedTeam_status_idx`(`assignedTeam`, `status`),
    INDEX `admin_work_item_assignedToId_status_idx`(`assignedToId`, `status`),
    INDEX `admin_work_item_responseDueAt_status_idx`(`responseDueAt`, `status`),
    INDEX `admin_work_item_resolutionDueAt_status_idx`(`resolutionDueAt`, `status`),
    INDEX `admin_work_item_lastObservedAt_idx`(`lastObservedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_work_item` ADD CONSTRAINT `admin_work_item_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
