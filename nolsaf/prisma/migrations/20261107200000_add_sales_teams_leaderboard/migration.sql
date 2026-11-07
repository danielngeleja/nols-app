-- Sales teams, targets and leaderboard months (prepared 2026-11-07, NOT applied; apply only with Daniel's approval)
--
-- sales_team          one team lead (an existing sales partner, same login) per team
-- sales_team_member   membership history; activeKey = partner id while current, so one team at a time
-- sales_partner_month per partner per month ("YYYY-MM", EAT): target, leaderboard exclusion,
--                     notification bookkeeping and the final result frozen at month close
--
-- Leaderboard points are computed from existing evidence (owner confirmations, verified visits,
-- commissions after check-out); nothing here stores money.
--
-- Additive only: three new tables, nothing existing changes. Valid on MySQL 8 (staging) and
-- MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_team_member`; DROP TABLE `sales_partner_month`; DROP TABLE `sales_team`;

-- CreateTable
CREATE TABLE `sales_team` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadPartnerId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `region` VARCHAR(120) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `createdById` INTEGER NULL,
    `disbandedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_team_leadPartnerId_key`(`leadPartnerId`),
    INDEX `sales_team_status_idx`(`status`),
    INDEX `sales_team_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_team_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teamId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `activeKey` INTEGER NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `addedById` INTEGER NULL,

    UNIQUE INDEX `sales_team_member_activeKey_key`(`activeKey`),
    INDEX `sales_team_member_teamId_leftAt_idx`(`teamId`, `leftAt`),
    INDEX `sales_team_member_salesPartnerId_idx`(`salesPartnerId`),
    INDEX `sales_team_member_addedById_idx`(`addedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_partner_month` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `month` CHAR(7) NOT NULL,
    `target` INTEGER NULL,
    `targetSetById` INTEGER NULL,
    `targetSetByRole` VARCHAR(20) NULL,
    `excludedAt` DATETIME(3) NULL,
    `excludedById` INTEGER NULL,
    `excludedReason` VARCHAR(300) NULL,
    `liveRank` INTEGER NULL,
    `liveRankAt` DATETIME(3) NULL,
    `topThreeNotifiedAt` DATETIME(3) NULL,
    `nudgedAt` DATETIME(3) NULL,
    `finalRank` INTEGER NULL,
    `finalPoints` INTEGER NULL,
    `finalBreakdown` JSON NULL,
    `badges` JSON NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_partner_month_month_finalRank_idx`(`month`, `finalRank`),
    INDEX `sales_partner_month_targetSetById_idx`(`targetSetById`),
    INDEX `sales_partner_month_excludedById_idx`(`excludedById`),
    UNIQUE INDEX `sales_partner_month_salesPartnerId_month_key`(`salesPartnerId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_team` ADD CONSTRAINT `sales_team_leadPartnerId_fkey` FOREIGN KEY (`leadPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_team` ADD CONSTRAINT `sales_team_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_team_member` ADD CONSTRAINT `sales_team_member_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `sales_team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_team_member` ADD CONSTRAINT `sales_team_member_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_team_member` ADD CONSTRAINT `sales_team_member_addedById_fkey` FOREIGN KEY (`addedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_month` ADD CONSTRAINT `sales_partner_month_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_month` ADD CONSTRAINT `sales_partner_month_targetSetById_fkey` FOREIGN KEY (`targetSetById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_month` ADD CONSTRAINT `sales_partner_month_excludedById_fkey` FOREIGN KEY (`excludedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
