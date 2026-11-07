-- Sales team invites (prepared 2026-11-08, NOT applied; apply only with Daniel's approval)
--
-- sales_team_invite  a team lead's personal invitation for one person to join their team.
--                    The link token is stored as a SHA-256 hash only. The invite only tags a
--                    normal partner application; an administrator approves, and the recruit
--                    joins the team when their agreement is activated.
--
-- Requires 20261107200000_add_sales_teams_leaderboard (sales_team). Additive only: one new
-- table. Valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_team_invite`;

-- CreateTable
CREATE TABLE `sales_team_invite` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(32) NOT NULL,
    `teamId` INTEGER NOT NULL,
    `leadPartnerId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `inviteeName` VARCHAR(120) NOT NULL,
    `inviteePhone` VARCHAR(40) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'SENT',
    `expiresAt` DATETIME(3) NOT NULL,
    `openedAt` DATETIME(3) NULL,
    `acceptedUserId` INTEGER NULL,
    `acceptedAt` DATETIME(3) NULL,
    `flags` JSON NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedById` INTEGER NULL,
    `decisionNote` VARCHAR(300) NULL,
    `partnerId` INTEGER NULL,
    `joinedAt` DATETIME(3) NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_team_invite_reference_key`(`reference`),
    UNIQUE INDEX `sales_team_invite_tokenHash_key`(`tokenHash`),
    INDEX `sales_team_invite_teamId_status_idx`(`teamId`, `status`),
    INDEX `sales_team_invite_leadPartnerId_status_idx`(`leadPartnerId`, `status`),
    INDEX `sales_team_invite_acceptedUserId_idx`(`acceptedUserId`),
    INDEX `sales_team_invite_partnerId_idx`(`partnerId`),
    INDEX `sales_team_invite_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_team_invite` ADD CONSTRAINT `sales_team_invite_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `sales_team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

