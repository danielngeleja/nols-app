-- Sales partner ID cards (prepared 2026-11-07, NOT applied; apply only with Daniel's approval)
--
-- A downloadable, shareable digital ID card for each sales partner. A
-- property owner scans its QR code (or types the card code) and NoLSAF
-- confirms live that the person is a current sales partner, with photo and
-- name. Revoking or replacing a card kills its link immediately.
--
-- Security: the QR token is derived from the card id + per-card salt with the
-- server secret, so the database alone cannot produce a valid link; only its
-- SHA-256 hash is stored (tokenHash). activeKey = salesPartnerId while ACTIVE,
-- NULL otherwise: the unique index allows one active card per partner.
--
-- Additive only: one new table, nothing existing changes. Valid on MySQL 8
-- (staging) and MariaDB 11.8 (production).
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_partner_card`;

-- CreateTable
CREATE TABLE `sales_partner_card` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `cardNumber` VARCHAR(40) NOT NULL,
    `salt` CHAR(32) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `photoUrl` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `activeKey` INTEGER NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedById` INTEGER NULL,
    `revokeReason` VARCHAR(300) NULL,
    `verifyCount` INTEGER NOT NULL DEFAULT 0,
    `lastVerifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_partner_card_cardNumber_key`(`cardNumber`),
    UNIQUE INDEX `sales_partner_card_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `sales_partner_card_activeKey_key`(`activeKey`),
    INDEX `sales_partner_card_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_partner_card_revokedById_idx`(`revokedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_partner_card` ADD CONSTRAINT `sales_partner_card_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_card` ADD CONSTRAINT `sales_partner_card_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
